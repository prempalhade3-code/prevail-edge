"""Kill / iptables fault injection against the Docker edge mesh."""

from __future__ import annotations

import os
import subprocess
import time
from typing import Optional


def _compose(*args: str) -> subprocess.CompletedProcess[str]:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    cmd = ["docker", "compose", "-f", os.path.join(root, "deploy", "docker-compose.yml"), *args]
    return subprocess.run(cmd, cwd=root, capture_output=True, text=True)


def kill_edge(edge_id: str = "edge-c") -> None:
    result = _compose("kill", edge_id)
    if result.returncode != 0:
        raise RuntimeError(f"docker compose kill {edge_id} failed: {result.stderr}")


def start_edge(edge_id: str = "edge-c") -> None:
    result = _compose("start", edge_id)
    if result.returncode != 0:
        raise RuntimeError(f"docker compose start {edge_id} failed: {result.stderr}")


def iptables_drop_quic(edge_id: str = "edge-b", peer_port: int = 9101) -> None:
    result = subprocess.run(
        [
            "docker",
            "exec",
            f"prevail-{edge_id}",
            "iptables",
            "-A",
            "OUTPUT",
            "-p",
            "udp",
            "--dport",
            str(peer_port),
            "-j",
            "DROP",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"iptables drop failed on {edge_id}: {result.stderr}")


def iptables_clear(edge_id: str = "edge-b") -> None:
    subprocess.run(
        ["docker", "exec", f"prevail-{edge_id}", "iptables", "-F", "OUTPUT"],
        capture_output=True,
        text=True,
        check=False,
    )


def wait(seconds: float) -> None:
    time.sleep(seconds)


def compose_running() -> bool:
    result = _compose("ps", "--status", "running")
    return result.returncode == 0 and "edge-a" in (result.stdout + result.stderr)


def kill_host_listener(port: int) -> int:
    pids: list[str] = []
    for spec in (f"tcp:{port}", f"udp:{port}", f":{port}"):
        result = subprocess.run(
            ["lsof", "-ti", spec],
            capture_output=True,
            text=True,
        )
        pids.extend(p for p in result.stdout.split() if p.strip())
        if pids:
            break
    if not pids:
        raise RuntimeError(f"no process listening on {port}")
    unique = list(dict.fromkeys(pids))
    for pid in unique:
        subprocess.run(["kill", "-9", pid], check=False)
    return int(unique[0])


def iptables_drop_host_quic(peer_port: int = 9101) -> None:
    result = subprocess.run(
        ["sudo", "-n", "iptables", "-A", "OUTPUT", "-p", "udp", "--dport", str(peer_port), "-j", "DROP"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"host iptables drop failed: {result.stderr}")


def iptables_clear_host() -> None:
    subprocess.run(
        ["sudo", "-n", "iptables", "-F", "OUTPUT"],
        capture_output=True,
        text=True,
        check=False,
    )
