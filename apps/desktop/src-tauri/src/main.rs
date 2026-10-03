// Prevents an extra console window on Windows in release. DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! AIVN 的桌面壳：一层窗口，加上一个由它拉起、也由它收掉的服务端。
//!
//! 业务一行都不在这里。壳子只负责四件事：
//!
//! 1. **拉起 sidecar**（随包的 `aivn-server.exe`，pkg 打的单文件服务端，见 `scripts/build-exe.mjs`），
//!    参数是 `--no-open --exit-on-stdin-close`。端口由服务端自己定（默认 8787，被占就往后让），
//!    壳子不许猜，只能从它的 stdout 上认。
//! 2. **握手**：窗口先显示随包的启动页（`ui/index.html`），stdout 上出现本机地址那一行再
//!    `navigate` 过去。失败就把服务端最后几行原样摊在启动页上——桌面壳没有控制台，
//!    不写在这里用户只能对着一个白窗口猜。
//! 3. **报出局域网地址**：写进标题栏。服务端把「手机该连哪儿」打在日志里，而日志在这个形态下
//!    没人看得见；不写出来，局域网访问这个能力等于不存在。
//! 4. **回收**：正常退出时先断管道再 kill；壳子被强杀时只剩管道断开这一条路——
//!    服务端 `--exit-on-stdin-close` 读到 EOF 自己收工，不会留在后台占着端口和数据目录。
//!
//! 为什么不用 `tauri-plugin-shell`：它的 sidecar API 要过 capabilities 权限表才肯动，
//! 而我们要的只是「spawn 一个自己带的 exe、读它的 stdout」，std 就够了；
//! 少一层 ACL 就少一类「为什么没权限」的运行时故障。

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent};

/// 服务端就绪时打印的地址前缀（`apps/server/src/index.ts` 的「就绪」那一行）。
/// 按 URL 形状认而不是按中文词认：改文案不该把启动握手改崩。
const READY_PREFIX: &str = "http://127.0.0.1:";
/// 握手超时。首次启动要解开 pkg 快照、起服务、建数据目录，给足但别无限等。
const READY_TIMEOUT: Duration = Duration::from_secs(90);
/// 就绪之后再等这么久，用来捡局域网地址那一行。
const LAN_GRACE: Duration = Duration::from_secs(5);
/// 失败提示里最多回放多少行输出。
const DIAG_LINES: usize = 40;
/// sidecar 的日志落到数据目录下的这个名字。
const LOG_FILE: &str = "desktop.log";

/// sidecar 的消息按行送到握手线程。
enum Out {
    Line(String),
    /// 进程自己退了（或管道断了）。
    Eof,
}

/// 活着的 sidecar 与它的管道，挂在 Tauri 的托管状态里。
struct Sidecar {
    child: Mutex<Option<Child>>,
    /// 攥住 stdin 的写端。它一被 drop（壳子退出）管道就断，服务端读到 EOF 自己收工——
    /// 这是壳子被强杀时唯一还管用的回收路径。
    stdin: Mutex<Option<ChildStdin>>,
}

/// sidecar 的输出落一份到 `<exe 同级>/data/desktop.log`。
///
/// 这个形态下没有控制台，服务端那些「生图失败」「音色库抓取失败」不落盘就是永久丢失；
/// 用户来问的时候至少有一份能看的东西。
#[derive(Clone)]
struct LogFile(Arc<Mutex<Option<File>>>);

impl LogFile {
    fn open(dir: &Path) -> Self {
        let file = fs::create_dir_all(dir)
            .ok()
            .and_then(|()| OpenOptions::new().create(true).append(true).open(dir.join(LOG_FILE)).ok());
        LogFile(Arc::new(Mutex::new(file)))
    }

    fn write(&self, line: &str) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(file) = guard.as_mut() {
                // 不套 BufWriter：日志本来就稀疏，直接落盘才能在被强杀时留住最后一行
                let _ = writeln!(file, "{line}");
            }
        }
    }
}

/// stderr 的滚动尾巴：只留最后 [`DIAG_LINES`] 行，启动失败时原样回放。
#[derive(Clone, Default)]
struct Diag(Arc<Mutex<Vec<String>>>);

impl Diag {
    fn push(&self, line: String) {
        let Ok(mut lines) = self.0.lock() else {
            return;
        };
        lines.push(line);
        let overflow = lines.len().saturating_sub(DIAG_LINES);
        if overflow > 0 {
            lines.drain(0..overflow);
        }
    }

    fn tail(&self) -> String {
        self.0.lock().map(|lines| lines.join("\n")).unwrap_or_default()
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 第二次双击只把已有窗口拎到前面。两个实例会去写同一份 data/，
            // 剧目与设置互相覆盖，比「没反应」难查得多。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            // 起服务与握手要等（首次启动解快照是秒级的），不能压在 setup 里把窗口卡住
            let handle = app.handle().clone();
            thread::spawn(move || boot(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("AIVN 桌面壳构建失败")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                shutdown(app);
            }
        });
}

/// 拉起服务端 → 等它报地址 → 把窗口指过去 → 报出局域网地址。
fn boot(app: AppHandle) {
    let dir = match exe_dir() {
        Ok(dir) => dir,
        Err(message) => return fail(&app, &message),
    };
    let log = LogFile::open(&dir.join("data"));

    let (child, stdin, lines, diag) = match spawn_sidecar(&dir, &log) {
        Ok(parts) => parts,
        Err(message) => return fail(&app, &message),
    };
    app.manage(Sidecar { child: Mutex::new(Some(child)), stdin: Mutex::new(Some(stdin)) });

    let Some(url) = wait_ready(&lines) else {
        return fail(&app, &startup_failure(&app, &diag));
    };
    let target = match url.parse::<tauri::Url>() {
        Ok(target) => target,
        Err(error) => return fail(&app, &format!("服务端报出的地址 {url} 解析不了：{error}")),
    };
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.navigate(target) {
            return fail(&app, &format!("打不开页面 {url}：{error}"));
        }
    }

    if let Some(lan) = wait_lan(&lines) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_title(&format!("AIVN · 局域网 {lan}（手机连同一个 Wi-Fi 打开它）"));
        }
    }

    // 收尾线程：管道不读满就会把服务端卡死，所以握手结束之后还得一直抽干它。
    thread::spawn(move || while lines.recv().is_ok() {});
}

/// 起 sidecar 并把它的 stdout / stderr 接到读取线程上。
///
/// 返回的 `diag` 是 stderr 的滚动尾巴（启动失败时那就是全部线索）；stdout 的行由
/// `lines` 一路送出来。
fn spawn_sidecar(dir: &Path, log: &LogFile) -> Result<(Child, ChildStdin, Receiver<Out>, Diag), String> {
    let path = dir.join(if cfg!(windows) { "aivn-server.exe" } else { "aivn-server" });
    if !path.is_file() {
        return Err(format!("随包的服务端没找到：{}", path.display()));
    }

    let mut command = Command::new(&path);
    command
        // 开浏览器是壳子的事（窗口本身就是），别再弹一个
        .args(["--no-open", "--exit-on-stdin-close"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 壳子是 windows_subsystem = "windows"，本来就没有控制台；不加这个子进程会自己弹一个黑框
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|error| format!("起不来 {}：{error}", path.display()))?;
    let Some(stdin) = child.stdin.take() else {
        return Err("拿不到服务端的 stdin".to_string());
    };
    let Some(stdout) = child.stdout.take() else {
        return Err("拿不到服务端的 stdout".to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        return Err("拿不到服务端的 stderr".to_string());
    };

    let (tx, rx) = mpsc::channel();
    let out_log = log.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(|line| line.ok()) {
            out_log.write(&line);
            if tx.send(Out::Line(line)).is_err() {
                break;
            }
        }
        let _ = tx.send(Out::Eof);
    });

    let diag = Diag::default();
    let err_log = log.clone();
    let err_diag = diag.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(|line| line.ok()) {
            err_log.write(&line);
            err_diag.push(line);
        }
    });

    Ok((child, stdin, rx, diag))
}

/// 等 stdout 上报出本机地址。
fn wait_ready(lines: &Receiver<Out>) -> Option<String> {
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        let left = deadline.checked_duration_since(Instant::now()).filter(|left| !left.is_zero())?;
        match lines.recv_timeout(left) {
            Ok(Out::Line(line)) => {
                if let Some(url) = ready_url(&line) {
                    return Some(url);
                }
            }
            // 进程退了、或者发送端没了：都不会再来地址了
            Ok(Out::Eof) | Err(RecvTimeoutError::Disconnected | RecvTimeoutError::Timeout) => return None,
        }
    }
}

/// 就绪之后服务端紧接着会报局域网地址；捡一条出来（拿不到就算了，标题保持 "AIVN"）。
fn wait_lan(lines: &Receiver<Out>) -> Option<String> {
    let deadline = Instant::now() + LAN_GRACE;
    loop {
        let left = deadline.checked_duration_since(Instant::now()).filter(|left| !left.is_zero())?;
        match lines.recv_timeout(left) {
            Ok(Out::Line(line)) => {
                if let Some(lan) = lan_url(&line) {
                    return Some(lan);
                }
            }
            _ => return None,
        }
    }
}

/// 从一行日志里认出本机地址，返回 `http://127.0.0.1:<port>`。
fn ready_url(line: &str) -> Option<String> {
    let start = line.find(READY_PREFIX)?;
    let digits: String = line[start + READY_PREFIX.len()..].chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    Some(format!("{READY_PREFIX}{digits}"))
}

/// 从「局域网  http://192.168.x.x:8787」那一行里取出整个地址。
fn lan_url(line: &str) -> Option<String> {
    if !line.contains("局域网") {
        return None;
    }
    let start = line.find("http://")?;
    let rest = &line[start..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    Some(rest[..end].to_string())
}

/// 正常退出：先断管道（服务端自己收工），再补一刀 kill。
fn shutdown(app: &AppHandle) {
    let Some(sidecar) = app.try_state::<Sidecar>() else {
        return;
    };
    if let Ok(mut stdin) = sidecar.stdin.lock() {
        stdin.take();
    }
    if let Ok(mut child) = sidecar.child.lock() {
        if let Some(mut child) = child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// 启动失败时给用户的整段说明：服务端是怎么没的 + 它最后说的话。
fn startup_failure(app: &AppHandle, diag: &Diag) -> String {
    let exited = app.try_state::<Sidecar>().and_then(|sidecar| {
        let mut guard = sidecar.child.lock().ok()?;
        guard.as_mut()?.try_wait().ok().flatten()
    });
    let headline = match exited {
        Some(status) => describe_exit(status),
        None => format!("等了 {} 秒也没等到服务端报出地址。", READY_TIMEOUT.as_secs()),
    };
    let tail = diag.tail();
    if tail.trim().is_empty() { headline } else { format!("{headline}\n\n{tail}") }
}

fn describe_exit(status: ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("服务端已退出（退出码 {code}）。"),
        None => "服务端被强制结束。".to_string(),
    }
}

/// 把失败信息写到启动页上（`ui/index.html` 的 `window.aivnFailed`）。
fn fail(app: &AppHandle, message: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let literal = serde_json::to_string(message).unwrap_or_else(|_| "\"启动失败\"".to_string());
    let _ = window.eval(&format!("window.aivnFailed({literal})"));
}

/// 壳子自己所在的目录。服务端与它同级，数据目录是它下面的 `data/`。
fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| format!("找不到自己所在的目录：{error}"))?;
    exe.parent().map(Path::to_path_buf).ok_or_else(|| "找不到自己所在的目录".to_string())
}

#[cfg(test)]
mod tests {
    use super::{lan_url, ready_url};

    #[test]
    fn picks_up_the_ready_url() {
        let line = "[aivn] 就绪  http://127.0.0.1:8788  (REST /api/plays, WS /ws?play=<id>)";
        assert_eq!(ready_url(line).as_deref(), Some("http://127.0.0.1:8788"));
    }

    #[test]
    fn ignores_lines_without_a_port() {
        assert_eq!(ready_url("[aivn] 数据目录  C:\\aivn\\data"), None);
        assert_eq!(ready_url("[aivn] 局域网  http://192.0.2.10:8787"), None);
    }

    #[test]
    fn picks_up_the_lan_url() {
        let line = "[aivn] 局域网  http://192.0.2.10:8787";
        assert_eq!(lan_url(line).as_deref(), Some("http://192.0.2.10:8787"));
        assert_eq!(lan_url("[aivn] 就绪  http://127.0.0.1:8787"), None);
    }
}
