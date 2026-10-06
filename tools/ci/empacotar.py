"""
Empacota a saída do `dotnet publish` do app do PC no formato das releases (igual às anteriores):
  - Windows e macOS: .zip   - Linux: .tar.gz
Fica só o app, as bibliotecas nativas que acompanham (macOS) e o settings.example.json; sem .pdb.
O executável sai marcado como executável (permissão 755) para abrir direto no Linux e no macOS.

    python tools/ci/empacotar.py <pasta-do-publish> <arquivo-de-saida.zip|.tar.gz>
"""
import os
import sys
import tarfile
import zipfile

KEEP_EXEC = {"AgentControl"}


def files(src):
    for name in sorted(os.listdir(src)):
        path = os.path.join(src, name)
        if os.path.isfile(path) and not name.lower().endswith(".pdb"):
            yield name, path


def main():
    src, out = sys.argv[1], sys.argv[2]
    items = list(files(src))
    if not any(n in ("AgentControl", "AgentControl.exe") for n, _ in items):
        sys.exit(f"não achei o executável em {src}")
    if out.endswith(".zip"):
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for name, path in items:
                info = zipfile.ZipInfo.from_file(path, name)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = ((0o755 if name in KEEP_EXEC else 0o644) << 16)
                with open(path, "rb") as f:
                    z.writestr(info, f.read(), compresslevel=9)
    elif out.endswith(".tar.gz"):
        with tarfile.open(out, "w:gz", compresslevel=9) as t:
            for name, path in items:
                info = t.gettarinfo(path, name)
                info.mode = 0o755 if name in KEEP_EXEC else 0o644
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                with open(path, "rb") as f:
                    t.addfile(info, f)
    else:
        sys.exit("a saída precisa terminar em .zip ou .tar.gz")
    print(f"{out}: {os.path.getsize(out) / 1_048_576:.1f} MB, {len(items)} arquivos: {', '.join(n for n, _ in items)}")


if __name__ == "__main__":
    main()
