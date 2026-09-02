{
  description = "sviber Sunniesnow chart editor";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" ];

      toISO =
        date:
        if date == null || date == "" then
          null
        else
          "${builtins.substring 0 4 date}-${builtins.substring 4 2 date}-${builtins.substring 6 2 date}T${builtins.substring 8 2 date}:${builtins.substring 10 2 date}:${builtins.substring 12 2 date}Z";

      importNixpkgs = import nixpkgs;
      forAllSystems =
        f:
        builtins.foldl' (
          attrs: system:
          attrs
          // {
            ${system} = f (importNixpkgs {
              inherit system;
            });
          }
        ) { } systems;

    in
    {
      packages = forAllSystems (pkgs: rec {
        sviber = pkgs.callPackage ./default.nix {
          gitRev = self.rev or null;
          gitCommitDate = toISO (self.lastModifiedDate or null);
        };

        default = sviber;
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-tree);
    };
}
