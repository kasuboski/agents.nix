# Same immutable nixpkgs snapshot as the mono-verde reference shell.
{
  pkgs ? import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/50ab793786d9de88ee30ec4e4c24fb4236fc2674.tar.gz";
    sha256 = "1s2gr5rcyqvpr58vxdcb095mdhblij9bfzaximrva2243aal3dgx";
  }) { },
}:

let
  # OTP configure needs OpenSSL headers and libraries under one prefix.
  opensslForOtp = pkgs.symlinkJoin {
    name = "openssl-for-otp";
    paths = [
      pkgs.openssl.out
      pkgs.openssl.dev
    ];
  };
in
pkgs.mkShell {
  # Mise owns Gleam, Erlang, and Rebar; Nix supplies OTP build prerequisites.
  packages = with pkgs; [
    mise
    autoconf
    gcc
    gnumake
    ncurses
    opensslForOtp
    perl
    pkg-config
  ];

  KERL_CONFIGURE_OPTIONS = "--without-javac --without-wx --with-ssl=${opensslForOtp}";
}
