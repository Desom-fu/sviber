#ifndef Architecture
#define Architecture "universal"
#endif

[Setup]
AppName=sviber
AppVersion={#AppVersion}
DefaultDirName={autopf}\sviber
DefaultGroupName=sviber
OutputBaseFilename=sviber-{#AppVersion}-{#Architecture}-setup
OutputDir=..\..\build\installer
ArchitecturesInstallIn64BitMode=x64compatible

[Registry]
Root: HKCU; Subkey: "Software\Classes\.sviber"; ValueType: string; ValueName: ""; ValueData: "sviber.project"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.json"; ValueType: string; ValueName: ""; ValueData: "sviber.chart"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.txt"; ValueType: string; ValueName: ""; ValueData: "sviber.lyrica"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\sviber.project"; ValueType: string; ValueName: ""; ValueData: "sviber project"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\sviber.project\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\sviber.exe,0"
Root: HKCU; Subkey: "Software\Classes\sviber.project\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\sviber.exe"" "%1""
Root: HKCU; Subkey: "Software\Classes\sviber.chart"; ValueType: string; ValueName: ""; ValueData: "sviber JSON chart"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\sviber.chart\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\sviber.exe,0"
Root: HKCU; Subkey: "Software\Classes\sviber.chart\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\sviber.exe"" "%1""
Root: HKCU; Subkey: "Software\Classes\sviber.lyrica"; ValueType: string; ValueName: ""; ValueData: "sviber Lyrica chart"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\sviber.lyrica\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\sviber.exe,0"
Root: HKCU; Subkey: "Software\Classes\sviber.lyrica\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\sviber.exe"" "%1""

[Files]
Source: "..\..\build\nw\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
