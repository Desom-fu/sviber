{ lib, stdenv, nodejs, nwjs, fetchurl, importNpmLock, makeWrapper }:

let
  package = builtins.fromJSON (builtins.readFile ./package.json);
  fontManifest = builtins.fromJSON (builtins.readFile ./json/font-assets.json);
  fonts = map (asset: {
    inherit (asset) name;
    source = fetchurl {
      urls = asset.urls;
      sha256 = lib.toLower asset.sha256;
    };
  }) fontManifest;
in stdenv.mkDerivation {
  pname = "sviber";
  inherit (package) version;
  src = lib.cleanSource ./.;
  npmDeps = importNpmLock { npmRoot = ./.; };
  nativeBuildInputs = [ nodejs importNpmLock.npmConfigHook makeWrapper ];
  buildPhase = ''
    runHook preBuild
    mkdir -p node_modules/.cache/sviber/fonts
    ${lib.concatMapStringsSep "\n" (font: "cp ${font.source} node_modules/.cache/sviber/fonts/${lib.escapeShellArg font.name}") fonts}
    export SVIBER_NW_PACKAGE_ONLY=1
    npm run build
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/sviber
    cp build/sviber-${package.version}.nw $out/share/sviber/
    mkdir -p $out/bin
    makeWrapper ${lib.getExe nwjs} $out/bin/sviber \
      --add-flags $out/share/sviber/sviber-${package.version}.nw
    runHook postInstall
  '';
  meta = {
    description = "Desktop-style Sunniesnow chart editor";
    homepage = "https://sunniesnow.github.io/sviber/";
    license = lib.licenses.agpl3Plus;
    platforms = lib.platforms.linux;
  };
}
