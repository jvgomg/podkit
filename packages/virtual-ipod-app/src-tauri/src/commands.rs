use crate::vm;

const VM_NAME: &str = "virtual-ipod";
const SERVER_URL: &str = "http://localhost:3456";

#[tauri::command]
pub fn vm_status() -> Result<String, String> {
    if !vm::vm_exists(VM_NAME) {
        return Ok("not-created".to_string());
    }
    if vm::vm_running(VM_NAME) {
        Ok("running".to_string())
    } else {
        Ok("stopped".to_string())
    }
}

#[tauri::command]
pub fn vm_start() -> Result<(), String> {
    if !vm::vm_exists(VM_NAME) {
        return Err("VM not created. Run: limactl create --name virtual-ipod tools/lima/virtual-ipod.yaml".to_string());
    }
    if !vm::vm_running(VM_NAME) {
        vm::start_vm(VM_NAME)?;
    }
    Ok(())
}

#[tauri::command]
pub fn vm_stop() -> Result<(), String> {
    vm::stop_vm(VM_NAME)
}

#[tauri::command]
pub async fn server_health() -> Result<bool, String> {
    let client = reqwest::Client::new();
    match client.get(format!("{}/status", SERVER_URL))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}
