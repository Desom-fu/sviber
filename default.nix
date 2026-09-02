{
  lib,
  stdenv,
  nodejs,
  nwjs,
  fetchurl,
  npmHooks,
  importNpmLock,
  makeWrapper,
  gitRev ? null,
  gitCommitDate ? null,
}:

let
  package = builtins.fromJSON (builtins.readFile ./package.json);
  fonts = map (asset: {
    inherit (asset) name;
    source = fetchurl {
      urls = asset.urls;
      sha256 = lib.toLower asset.sha256;
    };
  }) (builtins.fromJSON (builtins.readFile ./json/font-assets.json));
in

stdenv.mkDerivation {
  pname = package.name;
  inherit (package) version;

  src = lib.cleanSource ./.;

  npmDeps = importNpmLock { npmRoot = ./.; };

  nativeBuildInputs = [
    nodejs
    importNpmLock.npmConfigHook
    npmHooks.npmBuildHook
    makeWrapper
  ];

  preBuild = ''
    mkdir -p node_modules/.cache/sviber/fonts
    ${lib.concatMapStringsSep "\n" (
      font: "cp ${font.source} node_modules/.cache/sviber/fonts/${lib.escapeShellArg font.name}"
    ) fonts}
  '';

  env = {
    SVIBER_NW_PACKAGE_ONLY = "1";
  }
  // lib.optionalAttrs (gitRev != null) {
    SVIBER_BUILD_COMMIT = gitRev;
  }
  // lib.optionalAttrs (gitCommitDate != null) {
    SVIBER_BUILD_COMMIT_DATE = gitCommitDate;
  };
  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin
    mkdir -p $out/share/sviber
    cp build/sviber-${package.version}.nw $out/share/sviber/
    makeWrapper ${lib.getExe nwjs} $out/bin/sviber \
      --add-flags $out/share/sviber/sviber-${package.version}.nw

    mkdir -p $out/share/applications $out/share/mime/packages
    cp packaging/linux/sviber.desktop $out/share/applications/
    cp packaging/linux/sviber.xml $out/share/mime/packages/

    mkdir -p $out/share/icons/hicolor/scalable/apps
    cp svg/icon.svg $out/share/icons/hicolor/scalable/apps/sviber.svg

    runHook postInstall
  '';

  meta = {
    inherit (package) description;
    homepage = "https://sunniesnow.github.io/sviber/";
    changelog = "https://github.com/Desom-fu/sviber/releases/tag/v${package.version}";
    downloadPage = "https://github.com/Desom-fu/sviber/releases/tag/v${package.version}";
    license = lib.licenses.agpl3Plus;
  };
}
