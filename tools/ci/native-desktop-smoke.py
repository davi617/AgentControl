"""Run the packaged app on its native platform; keep evidence outside the source tree."""
import json
import os
import pathlib
import struct
import subprocess
import sys

exe = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=True)
env = os.environ.copy()
config_dir = out / "configuration with spaces"
config_dir.mkdir(exist_ok=True)
env["JARVIS_CONFIG"] = str(config_dir / "first run.json")
screens = out / "screens"

def run(label, args, graphical=False, expected_exit=0):
    command = [str(exe), *args]
    if graphical and sys.platform.startswith("linux") and env.get("AGENTCONTROL_TEST_DISPLAY_READY") != "1":
        command = ["xvfb-run", "-a", "-s", "-screen 0 1440x1000x24", *command]
    with (out / f"{label}.log").open("w") as log:
        proc = subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=180)
    if proc.returncode != expected_exit:
        raise RuntimeError(f"{label} exited {proc.returncode}; see log")

run("first-run", ["--time", "CLAUDE,GROK,CHATGPT"])
config = json.loads(pathlib.Path(env["JARVIS_CONFIG"]).read_text())
project = next(p for p in config["projects"] if p["id"] == "main")
assert [a["id"] for a in project["agents"]] == ["CLAUDE", "GROK", "CHATGPT"]
assert project["agents"][1]["worktree"] == "~/AgentControl/agent-grok"
assert "worktree" not in project["agents"][2]
assert config["remote"]["enabled"] is False

# Existing agent metadata and other projects must survive team changes.
config_path = pathlib.Path(env["JARVIS_CONFIG"])
project["agents"][0]["worktree"] = "~/custom folder/claude"
project["agents"][0]["test_metadata"] = "preserve çã"
other_project = {"id": "untouched", "agents": [{"id": "OTHER", "worktree": "~/keep"}]}
config["projects"].append(other_project)
config["test_marker"] = "preserve unrelated settings"
config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
before = config_path.read_bytes()
run("update-team", ["--time", "claude,AIDER,CHATGPT,aider"])
updated = json.loads(config_path.read_text(encoding="utf-8"))
updated_project = next(p for p in updated["projects"] if p["id"] == "main")
assert [a["id"] for a in updated_project["agents"]] == ["CLAUDE", "AIDER", "CHATGPT"]
assert updated_project["agents"][0] == project["agents"][0]
assert updated_project["agents"][1]["worktree"] == "~/AgentControl/agent-aider"
assert "worktree" not in updated_project["agents"][2]
assert updated["projects"][1] == other_project
assert updated["test_marker"] == config["test_marker"]
assert pathlib.Path(str(config_path) + ".bak").read_bytes() == before

# Invalid-only input must fail without overwriting configuration or its backup.
before = config_path.read_bytes()
backup_before = pathlib.Path(str(config_path) + ".bak").read_bytes()
run("invalid-team", ["--time", "bad/name"], expected_exit=1)
assert config_path.read_bytes() == before
assert pathlib.Path(str(config_path) + ".bak").read_bytes() == backup_before
run("repeat-team", ["--time", "CLAUDE,AIDER,CHATGPT"])
assert json.loads(config_path.read_text(encoding="utf-8")) == updated

run("native-windows", ["--print", str(screens)], graphical=True)
if (screens / "erro.txt").exists():
    raise RuntimeError((screens / "erro.txt").read_text())
required = ["launcher", "launcher-agentes", "launcher-ajustes", "faixa", "mascote", "hud-0", "hud-4", "mini"]
images = {}
for name in required:
    path = screens / f"{name}.png"
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", name
    width, height = struct.unpack(">II", data[16:24])
    assert width >= 100 and height >= 20 and len(data) > 500, (name, width, height)
    images[name] = {"width": width, "height": height, "bytes": len(data)}
result = {"platform": sys.platform, "first_configuration": "PASS", "team_update_preservation": "PASS", "backup_preservation": "PASS", "invalid_input_no_changes": "PASS", "repeated_team": "PASS", "config_path_spaces": "PASS", "native_windows": "PASS", "screens": images}
(out / "result.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
