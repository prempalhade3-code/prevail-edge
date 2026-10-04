//! Live resource snapshots for speculation (cgroup on Linux, host sysctl on macOS).

use crate::types::EdgeCapability;

#[derive(Debug, Clone, Copy)]
pub struct ResourceSnapshot {
    pub cpu_available_ratio: f64,
    pub memory_available_ratio: f64,
    pub rss_bytes: u64,
}

impl ResourceSnapshot {
    pub fn sample() -> Self {
        if let Some(from_cgroup) = read_cgroup_v2() {
            return from_cgroup;
        }
        read_host_fallback()
    }
}

fn read_cgroup_v2() -> Option<ResourceSnapshot> {
    let mem_current = std::fs::read_to_string("/sys/fs/cgroup/memory.current").ok()?;
    let mem_max = std::fs::read_to_string("/sys/fs/cgroup/memory.max").ok()?;
    let current: f64 = mem_current.trim().parse().ok()?;
    let max = match mem_max.trim() {
        "max" => return None,
        other => other.parse::<f64>().ok()?,
    };
    if max <= 0.0 {
        return None;
    }
    let used = (current / max).clamp(0.0, 1.0);
    Some(ResourceSnapshot {
        cpu_available_ratio: process_cpu_ratio().unwrap_or(0.7),
        memory_available_ratio: (1.0 - used).clamp(0.05, 1.0),
        rss_bytes: process_rss_bytes(),
    })
}

fn read_host_fallback() -> ResourceSnapshot {
    #[cfg(target_os = "macos")]
    {
        let total = sysctl_u64("hw.memsize").unwrap_or(8 * 1024 * 1024 * 1024);
        let page_size = sysctl_u64("hw.pagesize").unwrap_or(4096);
        let free_pages = sysctl_u64("vm.page_free_count").unwrap_or(0);
        let free = (free_pages.saturating_mul(page_size)) as f64;
        let mem_avail = (free / total as f64).clamp(0.10, 0.95);
        return ResourceSnapshot {
            cpu_available_ratio: process_cpu_ratio().unwrap_or(0.65),
            memory_available_ratio: mem_avail,
            rss_bytes: process_rss_bytes(),
        };
    }
    #[cfg(not(target_os = "macos"))]
    {
        ResourceSnapshot {
            cpu_available_ratio: process_cpu_ratio().unwrap_or(0.70),
            memory_available_ratio: 0.65,
            rss_bytes: process_rss_bytes(),
        }
    }
}

fn process_rss_bytes() -> u64 {
    let pid = std::process::id().to_string();
    if let Ok(statm) = std::fs::read_to_string("/proc/self/statm") {
        if let Some(pages) = statm.split_whitespace().nth(1) {
            if let Ok(n) = pages.parse::<u64>() {
                return n.saturating_mul(4096);
            }
        }
    }
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid])
        .output()
        .ok();
    if let Some(out) = out {
        if let Ok(text) = String::from_utf8(out.stdout) {
            if let Ok(kb) = text.trim().parse::<u64>() {
                return kb.saturating_mul(1024);
            }
        }
    }
    0
}

fn process_cpu_ratio() -> Option<f64> {
    let pid = std::process::id().to_string();
    let out = std::process::Command::new("ps")
        .args(["-o", "%cpu=", "-p", &pid])
        .output()
        .ok()?;
    let text = String::from_utf8(out.stdout).ok()?;
    let pct: f64 = text.trim().parse().ok()?;
    Some((1.0 - (pct / 100.0)).clamp(0.05, 1.0))
}

#[cfg(target_os = "macos")]
fn sysctl_u64(name: &str) -> Option<u64> {
    let out = std::process::Command::new("sysctl")
        .args(["-n", name])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout)
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
}

pub fn apply_live_resources(cap: &mut EdgeCapability) {
    let snap = ResourceSnapshot::sample();
    cap.cpu_available_ratio = snap.cpu_available_ratio;
    cap.memory_available_ratio = snap.memory_available_ratio;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_is_bounded() {
        let snap = ResourceSnapshot::sample();
        assert!(snap.cpu_available_ratio > 0.0 && snap.cpu_available_ratio <= 1.0);
        assert!(snap.memory_available_ratio > 0.0 && snap.memory_available_ratio <= 1.0);
    }
}
