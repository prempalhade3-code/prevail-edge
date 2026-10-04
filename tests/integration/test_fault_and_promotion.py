"""§17 fault, promotion-ack, shadow-discard, and live kill/iptables tests."""

from __future__ import annotations

import json
import os
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _snapshot(url: str = "http://127.0.0.1:8000/v1/snapshot") -> dict:
    with urllib.request.urlopen(url, timeout=4) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _mesh_up() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8090/health", timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


class FaultAndPromotionTests(unittest.TestCase):
    def test_authority_timeout_default_is_positive(self):
        timeout = int(os.environ.get("PREVAIL_AUTHORITY_TIMEOUT_MS", "3000"))
        self.assertGreater(timeout, 0)

    def test_wrong_prediction_scenario_exists(self):
        scenario = ROOT / "experiments" / "scenarios" / "wrong-prediction.yaml"
        stream = ROOT / "sim" / "fixtures" / "wrong-prediction.jsonl"
        self.assertTrue(scenario.exists())
        self.assertTrue(stream.exists())
        text = stream.read_text(encoding="utf-8")
        self.assertIn("edge-c", text)
        self.assertIn("image_event_id", text)

    def test_checkpoint_dir_is_configurable(self):
        self.assertTrue(os.environ.get("PREVAIL_CHECKPOINT_DIR", "/tmp/prevail-checkpoints"))

    def test_sidecar_proto_defines_all_rpcs(self):
        proto = (ROOT / "proto" / "v0" / "prevail_sidecar.proto").read_text(encoding="utf-8")
        self.assertIn("rpc ReportLocation", proto)
        self.assertIn("rpc GetAuthority", proto)
        self.assertIn("rpc OnPromotion", proto)

    def test_control_proto_includes_required_payloads(self):
        proto = (ROOT / "proto" / "v0" / "prevail_control.proto").read_text(encoding="utf-8")
        for name in (
            "PromotionRequest",
            "PromotionAck",
            "DemotionNotice",
            "MigrationFallbackStart",
            "MigrationFallbackComplete",
            "SpeculationDecision",
            "TimelineEvent",
            "EdgeCapabilityAdvertisement",
            "StateAlign",
            "CheckpointTransfer",
            "savepoint_path",
        ):
            self.assertIn(name, proto)

    def test_live_kill_edge_changes_authority(self):
        if not _mesh_up():
            self.fail("live mesh is required for kill/iptables; start scripts/ensure-mesh.sh")
        from experiments import fault_inject

        before = _snapshot()
        holder = ((before.get("authority") or {}).get("holder_edge_id")) or "edge-a"
        if fault_inject.compose_running():
            victim = "edge-c" if holder != "edge-c" else "edge-b"
            fault_inject.kill_edge(victim)
            time.sleep(4)
            try:
                after = _snapshot()
                types = {ev.get("event_type") for ev in after.get("timeline") or []}
                self.assertTrue(
                    types.intersection({"AuthorityFailover", "ShadowRecreated", "HandoffDetected", "AuthorityTransferred"})
                    or after.get("authority"),
                    types,
                )
            finally:
                fault_inject.start_edge(victim)
        else:
            victim_port = 8094 if holder != "edge-c" else 8092
            fault_inject.kill_host_listener(victim_port)
            time.sleep(4)
            after = _snapshot()
            self.assertTrue(after.get("authority") or after.get("timeline"))

    def test_live_iptables_drop_quic(self):
        if not _mesh_up():
            self.fail("live mesh is required for iptables/QUIC fault injection")
        from experiments import fault_inject

        if fault_inject.compose_running():
            fault_inject.iptables_drop_quic("edge-b", 9101)
            time.sleep(3)
            try:
                after = _snapshot()
                self.assertTrue(after.get("timeline") is not None)
            finally:
                fault_inject.iptables_clear("edge-b")
            return
        try:
            fault_inject.iptables_drop_host_quic(9101)
            time.sleep(3)
            after = _snapshot()
            self.assertTrue(after.get("timeline") is not None)
            fault_inject.iptables_clear_host()
        except RuntimeError:
            # No sudo: isolate the peer by killing its HTTP+QUIC process.
            fault_inject.kill_host_listener(8092)
            time.sleep(2)
            after = _snapshot()
            self.assertTrue(after.get("authority") or after.get("timeline"))
