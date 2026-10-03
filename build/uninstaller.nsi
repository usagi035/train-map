;==============================================================
; RailwayMapEditor アンインストーラ生成用スクリプト
;--------------------------------------------------------------
; NSIS のアンインストーラは makensis のビルドだけでは作れない
; (WriteUninstaller は「インストーラを実行したとき」に書き出す)。
; このスクリプトは、その書き出しを行うための「生成用の小さな
; インストーラ」で、実体のアンインストーラ .exe を
;   %TEMP%\RailwayMapEditorUninstGen\
; に作り出す。scripts/make-uninstaller.js が dist/ へコピーする。
;
; アンインストーラ側はレジストリ・既定のインストール先を実行時に
; 調べるため、別マシンでも同じパスに依存せず動く。
;==============================================================

Unicode true
Name "RailwayMapEditor Uninstaller Generator"
OutFile "make-uninstaller.exe"
InstallDir "$TEMP\RailwayMapEditorUninstGen"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
BrandingText " "

;--------------------------------------------------------------
; 生成用インストーラ(何もせずアンインストーラを書き出すだけ)
;--------------------------------------------------------------
Section
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall RailwayMapEditor.exe"
SectionEnd

;==============================================================
; アンインストーラ本体
;==============================================================

Var FoundDir      ; インストール先フォルダ
Var DryRunFile    ; ドライラン出力先(テスト用)

; --- インストール先を特定する(レジストリ → 既定のフォルダの順) ---
Function un.FindInstDir
  StrCpy $FoundDir ""

  ; レジストリの DisplayIcon  "C:\...\RailwayMapEditor.exe,0" から辿る
  StrCpy $0 0
findReg:
  EnumRegKey $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
  StrCmp $1 "" findDefault
  ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
  StrCpy $3 $2 16
  StrCmp $3 "RailwayMapEditor" gotKey
  IntOp $0 $0 + 1
  Goto findReg
gotKey:
  ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayIcon"
  StrCpy $4 $2 2 -2          ; 末尾が ",0" なら取り除く
  StrCmp $4 ",0" 0 noComma
  StrCpy $2 $2 -2
noComma:
  StrCpy $2 $2 -21           ; "\RailwayMapEditor.exe"(21文字)を除去
  IfFileExists "$2\RailwayMapEditor.exe" 0 findDefault
  StrCpy $FoundDir $2
  Return

  ; 既定のインストールフォルダを順に試す
findDefault:
  StrCpy $FoundDir "$LOCALAPPDATA\Programs\railway-map-editor"
  IfFileExists "$FoundDir\RailwayMapEditor.exe" foundDir
  StrCpy $FoundDir "$LOCALAPPDATA\Programs\RailwayMapEditor"
  IfFileExists "$FoundDir\RailwayMapEditor.exe" foundDir
  StrCpy $FoundDir "$PROGRAMFILES\RailwayMapEditor"
  IfFileExists "$FoundDir\RailwayMapEditor.exe" foundDir
  StrCpy $FoundDir "$PROGRAMFILES64\RailwayMapEditor"
  IfFileExists "$FoundDir\RailwayMapEditor.exe" foundDir
  StrCpy $FoundDir ""        ; 見つからなかった
foundDir:
FunctionEnd

; --- レジストリのアンインストール情報を削除する(HIVE = HKCU / HKLM) ---
!macro DeleteUninstKey HIVE
  StrCpy $0 0
delKey_${HIVE}:
  EnumRegKey $1 ${HIVE} "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
  StrCmp $1 "" delKeyDone_${HIVE}
  ReadRegStr $2 ${HIVE} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
  StrCpy $2 $2 16
  StrCmp $2 "RailwayMapEditor" delKeyNow_${HIVE}
  IntOp $0 $0 + 1
  Goto delKey_${HIVE}
delKeyNow_${HIVE}:
  DeleteRegKey ${HIVE} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1"
  Goto delKey_${HIVE}         ; 削除後は同じ番号からやり直す
delKeyDone_${HIVE}:
!macroend

Section "Uninstall"
  ; ---------- テスト用ドライラン ----------
  ; RME_DRYRUN にファイル名を指定すると、インストール先を特定して
  ; そのパスを書き出すだけで終了する(何も削除しない)
  ReadEnvStr $DryRunFile "RME_DRYRUN"
  StrCmp $DryRunFile "" start
  Call un.FindInstDir
  FileOpen $0 $DryRunFile w
  FileWrite $0 $FoundDir
  FileClose $0
  Goto finish

start:
  Call un.FindInstDir
  StrCmp $FoundDir "" notFound

  ; ---------- 削除の確認 ----------
  IfSilent doRemove
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "路線図エディタをアンインストールしますか?$\r$\n$\r$\n削除するフォルダ:$\r$\n$FoundDir" IDYES doRemove
  Goto finish                 ; 「いいえ」は何もしない

notFound:
  IfSilent finish
  MessageBox MB_OK|MB_ICONEXCLAMATION "RailwayMapEditor が見つかりません。$\r$\nインストール先を特定できなかったため、中止します。"
  Goto finish

doRemove:
  ; ---------- 起動中なら終了させる ----------
  ExecWait '"$SYSDIR\taskkill.exe" /F /IM RailwayMapEditor.exe /T'

  ; ---------- ショートカット ----------
  SetShellVarContext current
  Delete "$SMPROGRAMS\RailwayMapEditor.lnk"
  Delete "$DESKTOP\RailwayMapEditor.lnk"
  Delete "$SMPROGRAMS\アンインストール RailwayMapEditor.lnk"
  SetShellVarContext all
  Delete "$SMPROGRAMS\RailwayMapEditor.lnk"
  Delete "$DESKTOP\RailwayMapEditor.lnk"
  SetShellVarContext current

  ; ---------- 本体 ----------
  RMDir /r "$FoundDir"

  ; ---------- ユーザーデータ(路線図)は確認してから ----------
  IfSilent regClean
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "作成した路線図データも削除しますか?$\r$\n$\r$\n$APPDATA\railway-map-editor$\r$\n$\r$\n「いいえ」でデータは残ります(次にインストールするとそのまま使えます)。" IDYES delData
  Goto regClean
delData:
  RMDir /r "$APPDATA\railway-map-editor"

  ; ---------- レジストリ(設定 → アプリの一覧)は最後に ----------
  ; フォルダの削除に失敗した場合も、あとから公式のアンインストーラで
  ; リカバリーできるよう、削除情報は最後に消す。
regClean:
  !insertmacro DeleteUninstKey HKCU
  !insertmacro DeleteUninstKey HKLM

finish:
  IfSilent done
  MessageBox MB_OK|MB_ICONINFORMATION "アンインストールが完了しました。"
done:
SectionEnd
