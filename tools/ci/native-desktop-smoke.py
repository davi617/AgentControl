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
env["JARVIS_CONFIG"] = str(out / "first-run.json")
screens = out / "screens"

def run(label, args, graphical=False):
    command = [str(exe), *args]
    if graphical and sys.platform.startswith("linux"):
        command = ["xvfb-run", "-a", "-s", "-screen 0 1440x1000x24", *command]
    with (out / f"{label}.log").open("w") as log:
        proc = subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=180)
    if proc.returncode:
        raise RuntimeError(f"{label} exited {proc.returncode}; see log")

run("first-run", ["--time", "CLAUDE,GROK,CHATGPT"])
config = json.loads(pathlib.Path(env["JARVIS_CONFIG"]).read_text())
project = next(p for p in config["projects"] if p["id"] == "main")
assert [a["id"] for a in project["agents"]] == ["CLAUDE", "GROK", "CHATGPT"]
assert project["agents"][1]["worktree"] == "~/AgentControl/agent-grok"
assert "worktree" not in project["agents"][2]
assert config["remote"]["enabled"] is False

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
result = {"platform": sys.platform, "first_configuration": "PASS", "native_windows": "PASS", "screens": images}
(out / "result.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
