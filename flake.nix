{
  description = "sviber Sunniesnow chart editor";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forSystem = system:
        let pkgs = import nixpkgs { inherit system; };
        in { packages.default = pkgs.callPackage ./default.nix { }; };
    in builtins.listToAttrs (map (system: { name = system; value = forSystem system; }) systems);
}
