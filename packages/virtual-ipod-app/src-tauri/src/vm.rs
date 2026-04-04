use std::process::Command;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct LimaInstance {
    name: String,
    status: String,
}

pub fn vm_exists(name: &str) -> bool {
    let output = Command::new("limactl")
        .args(["list", "--json"])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            // Lima outputs one JSON object per line
            stdout.lines().any(|line| {
                serde_json::from_str::<LimaInstance>(line)
                    .map(|inst| inst.name == name)
                    .unwrap_or(false)
            })
        }
        Err(_) => false,
    }
}

pub fn vm_running(name: &str) -> bool {
    let output = Command::new("limactl")
        .args(["list", "--json"])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.lines().any(|line| {
                serde_json::from_str::<LimaInstance>(line)
                    .map(|inst| inst.name == name && inst.status == "Running")
                    .unwrap_or(false)
            })
        }
        Err(_) => false,
    }
}

pub fn start_vm(name: &str) -> Result<(), String> {
    let status = Command::new("limactl")
        .args(["start", name])
        .status()
        .map_err(|e| format!("Failed to start VM: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err("limactl start failed".to_string())
    }
}

pub fn stop_vm(name: &str) -> Result<(), String> {
    let status = Command::new("limactl")
        .args(["stop", name])
        .status()
        .map_err(|e| format!("Failed to stop VM: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err("limactl stop failed".to_string())
    }
}
