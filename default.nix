{ lib, stdenv, nodejs, npm, nwjs, fetchurl ? null }:

stdenv.mkDerivation {
  pname = "sviber";
  version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
  src = lib.cleanSource ./.;
  nativeBuildInputs = [ nodejs npm ];
  buildPhase = ''
    export HOME=$TMPDIR/home
    mkdir -p "$HOME"
    npm ci --ignore-scripts
    npm run build
  '';
  installPhase = ''
    mkdir -p $out/share/sviber
    cp -r build/nw/. $out/share/sviber/
    mkdir -p $out/bin
    ln -s $out/share/sviber/sviber $out/bin/sviber
  '';
  meta = {
    description = "Desktop-style Sunniesnow chart editor";
    homepage = "https://sunniesnow.github.io/sviber/";
    license = lib.licenses.agpl3Plus;
    platforms = lib.platforms.linux;
  };
}
