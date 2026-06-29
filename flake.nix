{
  description = "Excalidraw fork — reproducible dev environment (Node + Yarn 1.x)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      # Systems we care to support.
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in
    {
      devShells = forAllSystems (pkgs:
        let
          # Project targets Node >= 18 and Yarn 1.x (yarn@1.22.22 in package.json).
          nodejs = pkgs.nodejs_22;
          # Pin classic Yarn (1.x) to the same Node to avoid a second toolchain.
          yarn = pkgs.yarn.override { inherit nodejs; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              nodejs
              yarn
            ];

            shellHook = ''
              echo "excalidraw dev shell — node $(node --version), yarn $(yarn --version)"
            '';
          };
        });
    };
}
