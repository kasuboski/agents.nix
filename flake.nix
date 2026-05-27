{
  description = "Personal AI coding agent wrappers with sops secrets and microsandbox sandboxing";

  nixConfig = {
    extra-substituters = [ "https://cache.numtide.com" ];
    extra-trusted-public-keys = [
      "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g="
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    systems.url = "github:nix-systems/default";

    # AI agent packages (pi, claude-code, codex, gemini-cli, etc.)
    llm-agents = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Microsandbox CLI for VM-based sandboxing
    # Not available on x86_64-darwin
    microsandbox-flake = {
      url = "github:kasuboski/microsandbox-flake";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      systems,
      llm-agents,
      microsandbox-flake,
    }:
    let
      # ── Platform matrix ───────────────────────────────────────────────
      allSystems = import systems;

      # microsandbox only supports these (no x86_64-darwin)
      sandboxSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      # The Linux architecture microsandbox VMs run on each host
      # aarch64-darwin (Apple Silicon) → aarch64-linux VM
      # x86_64-linux → x86_64-linux VM
      # aarch64-linux → aarch64-linux VM
      linuxSystem = system: if system == "aarch64-darwin" then "aarch64-linux" else system;

      forEachSystem = systemList: fn: nixpkgs.lib.genAttrs systemList (system: fn system);

      # ── Profile definitions ───────────────────────────────────────────
      # Each profile maps to an encrypted secrets file and produces
      # packages: pi-<profile> and pi-<profile>-boxed
      profiles = {
        personal = ./secrets/personal.enc.json;
        work = ./secrets/work.enc.json;
      };

      # The default profile — produces the bare "pi" and "pi-boxed" names
      defaultProfile = "personal";

      # ── Package builders ──────────────────────────────────────────────
      mkPi = import ./packages/mk-pi.nix;
      mkPiBoxed = import ./packages/mk-pi-boxed.nix;
      mkPiClosure = import ./packages/mk-pi-rootfs.nix;

      # Build all pi packages for a given system
      mkPiPackages =
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          upstream-pi = llm-agents.packages.${system}.pi;

          # Generate packages for each profile
          profilePackages = nixpkgs.lib.mapAttrs' (
            profileName: secretsFile:
            let
              isDefault = profileName == defaultProfile;
              profileArg = if isDefault then null else profileName;
            in
            {
              name = if isDefault then "pi" else "pi-${profileName}";
              value = mkPi {
                inherit pkgs;
                llm-agents-pi = upstream-pi;
                sops-file = secretsFile;
                profile = profileArg;
              };
            }
          ) profiles;

          # Generate boxed packages (only where microsandbox works)
          boxedPackages =
            if builtins.elem system sandboxSystems then
              let
                linuxSys = linuxSystem system;
                pkgs-linux = nixpkgs.legacyPackages.${linuxSys};
                upstream-pi-linux = llm-agents.packages.${linuxSys}.pi;
                closure = mkPiClosure {
                  pkgs = pkgs-linux;
                  llm-agents-pi = upstream-pi-linux;
                };
              in
              nixpkgs.lib.mapAttrs' (
                profileName: secretsFile:
                let
                  isDefault = profileName == defaultProfile;
                  profileArg = if isDefault then null else profileName;
                in
                {
                  name = if isDefault then "pi-boxed" else "pi-${profileName}-boxed";
                  value = mkPiBoxed {
                    inherit pkgs closure;
                    sops-file = secretsFile;
                    llm-agents-pi = upstream-pi;
                    llm-agents-pi-linux = upstream-pi-linux;
                    msb = microsandbox-flake.packages.${system}.msb;
                    profile = profileArg;
                  };
                }
              ) profiles
            else
              { };

        in
        profilePackages // boxedPackages;

      # Build apps from packages (for `nix run`)
      mkAppsFromPackages =
        system: packages:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        nixpkgs.lib.mapAttrs (name: pkg: {
          type = "app";
          program = "${pkg}/bin/${pkg.meta.mainProgram or name}";
        }) packages;

    in
    {
      # ── Packages ─────────────────────────────────────────────────────
      packages = forEachSystem allSystems (
        system:
        let
          piPackages = mkPiPackages system;
        in
        piPackages
        // {
          default = self.packages.${system}.pi;
        }
      );

      # ── Apps (for `nix run`) ─────────────────────────────────────────
      apps = forEachSystem allSystems (
        system:
        let
          piPackages = mkPiPackages system;
          piApps = mkAppsFromPackages system piPackages;
        in
        piApps
        // {
          default = self.apps.${system}.pi;
        }
      );

      # ── Dev Shell ────────────────────────────────────────────────────
      devShells = forEachSystem allSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              sops
              ssh-to-age
              jq
              nixfmt-tree
            ];

            shellHook = ''
              echo "AI agents dev shell"
              echo ""
              echo "  sops -e secrets/personal.json > secrets/personal.enc.json  # encrypt"
              echo "  sops -d secrets/personal.enc.json                          # decrypt"
              echo "  sops secrets/personal.enc.json                             # edit interactively"
              echo ""
              echo "  ssh-to-age -i ~/.ssh/id_ed25519.pub                       # show age public key"
            '';
          };
        }
      );

      # ── Formatter (nix fmt) ──────────────────────────────────────────
      formatter = forEachSystem allSystems (system: nixpkgs.legacyPackages.${system}.nixfmt-tree);

      # ── Overlays ─────────────────────────────────────────────────────
      overlays.default =
        final: prev:
        let
          system = final.stdenv.hostPlatform.system;
          systemPackages = self.packages.${system} or { };
        in
        if builtins.elem system allSystems then
          nixpkgs.lib.mapAttrs' (name: pkg: {
            name = "ai-${name}";
            value = pkg;
          }) systemPackages
        else
          { };
    };
}
