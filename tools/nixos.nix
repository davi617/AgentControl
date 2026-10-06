{ pkgs ? import <nixpkgs> {} }:
(pkgs.buildFHSEnv {
  name = "agent-control-env";
  targetPkgs = p: with p; [
    bash coreutils git nodejs_24 dotnet-sdk_8 python3
    icu openssl zlib stdenv.cc.cc.lib fontconfig dejavu_fonts xdg-utils
    xorg.libX11 xorg.libICE xorg.libSM xorg.libXrandr xorg.libXi
    xorg.libXcursor xorg.libXext xorg.xorgserver xorg.xauth
  ];
  profile = ''
    export AGENTCONTROL_NIX_ENV=1
    export FONTCONFIG_FILE=${pkgs.fontconfig.out}/etc/fonts/fonts.conf
  '';
  runScript = "bash";
})
