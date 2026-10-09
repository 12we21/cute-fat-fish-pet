; ============================================================================
;  可爱大肥鱼桌宠 · 安装程序（NSIS）——给小白用的一路「下一步」安装
; ----------------------------------------------------------------------------
;  产物：release\cute-fat-fish-pet-<版本>-setup.exe（文件名只用 ASCII，见下方 OutFile 注释）
;  安装到用户目录（默认 %LOCALAPPDATA%\BlueHairMaid），不需要管理员权限。
;  在桌面 + 开始菜单放快捷方式，在「设置 → 应用」登记卸载项，自带 Uninstall.exe。
;  人设/记忆/聊天记录在 %APPDATA%\BlueHairMaid，卸载时会问要不要一起删。
;
;  构建：python build\mkexe.py            ← 推荐（版本号取自 src\package.json）
;        makensis /INPUTCHARSET UTF8 /DAPP_VER=1.1.4 build\installer.nsi
;  （脚本必须以 UTF-8 带 BOM 保存，否则中文会乱码）
;  这里的路径全部相对 .nsi 自己的位置推导，仓库搬到哪台电脑都能编。
; ============================================================================

Unicode true

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APP_ID     "BlueHairMaid"
!define APP_NAME   "可爱大肥鱼桌宠"
!ifndef APP_VER
  !define APP_VER  "1.1.4"
!endif
!define APP_PUB    "Mikolu · MIT 开源（早期架构来自 PC2005-cloud 的 dsh-pet 0.3.0）"
!define ROOT       "${__FILEDIR__}\.."
!define STAGE      "${ROOT}\stage"
!define ART        "${ROOT}\build\nsis"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${APP_NAME}"
; 产物文件名只用 ASCII：GitHub Release 会把资产名里的非 ASCII 字符直接删掉
; （中文名上传后会变成 "-1.1.0-.exe"），所以对外发布的文件名保持英文，
; 中文只留在产品名 / 快捷方式 / 「应用和功能」里。
OutFile "${ROOT}\release\cute-fat-fish-pet-${APP_VER}-setup.exe"
InstallDir "$LOCALAPPDATA\${APP_ID}"
InstallDirRegKey HKCU "Software\${APP_ID}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${APP_VER}.0"
VIAddVersionKey /LANG=2052 "ProductName"     "${APP_NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "${APP_NAME} 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion"     "${APP_VER}"
VIAddVersionKey /LANG=2052 "ProductVersion"  "${APP_VER}"
VIAddVersionKey /LANG=2052 "LegalCopyright"  "MIT License"

!define MUI_ICON   "${STAGE}\launcher\pet.ico"
!define MUI_UNICON "${STAGE}\launcher\pet.ico"
!define MUI_ABORTWARNING

; 向导美术：左侧竖幅必须正好 164x314，内页右上角小横条必须正好 150x57，且都必须是 24 位 BMP
; （生成脚本 build\nsis\mk-art.py；改完重跑一次它就行）
!define MUI_WELCOMEFINISHPAGE_BITMAP   "${ART}\welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ART}\welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP         "${ART}\header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP       "${ART}\header.bmp"

!define MUI_WELCOMEPAGE_TITLE "欢迎安装 ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "这是一个会住在你桌面上的 Q 版蓝发小女仆，${APP_NAME} 是她住的房子。$\r$\n$\r$\n点「下一步」就会装到你的用户目录里（不需要管理员权限），桌面和开始菜单上会多个快捷方式。$\r$\n$\r$\n第一次打开控制台时，她会自己看看这台电脑适合用什么模型、要不要联网，不用你操心。"
!define MUI_DIRECTORYPAGE_TEXT_TOP "把 ${APP_NAME} 装到哪里？（默认装在你的用户目录里，不需要管理员权限，直接下一步就行）"

!define MUI_FINISHPAGE_TITLE "装好啦！"
!define MUI_FINISHPAGE_TEXT "${APP_NAME} 已经装好了。$\r$\n$\r$\n以后随时双击桌面上的「${APP_NAME}」就能打开控制台。$\r$\n第一次打开时她会自动检测这台电脑的显卡和本机模型，十几秒就好。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\electron\electron.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS "$\"$INSTDIR\launcher$\""
!define MUI_FINISHPAGE_RUN_TEXT "现在就打开控制台（第一次会自动检测本机模型）"
!define MUI_FINISHPAGE_LINK "先看看「使用说明.txt」"
!define MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR\使用说明.txt"

!define MUI_UNCONFIRMPAGE_TEXT_TOP "点「卸载」就会把 ${APP_NAME} 从这台电脑上删掉。$\r$\n$\r$\n人设、记忆、聊天记录放在别的地方，卸载时另行询问，默认给你留着。"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "SimpChinese"

; ------------------------------------------------------- 开装之前（升级要认得旧家）
; 之前装过的话（不管是用安装程序装的，还是用 zip 里 install.ps1 装的），
; 「应用和功能」的登记项里都留着 InstallLocation。那份还在，就直接拿它当安装目录 ——
; 免得主人点一下「下一步」又装出第二份 761 MB。
; 静默安装（/S，给脚本和验收用）不动目录，尊重命令行里的 /D=。
Function .onInit
  IfSilent oninit_done
  ReadRegStr $0 HKCU "${UNINST_KEY}" "InstallLocation"
  ${If} $0 != ""
    ${If} ${FileExists} "$0\electron\electron.exe"
      StrCpy $INSTDIR $0
    ${EndIf}
  ${EndIf}
oninit_done:
FunctionEnd

; ---------------------------------------------------------------- 安装
Section "主程序" SEC_MAIN
  SectionIn RO
  SetShellVarContext current
  SetDetailsPrint textonly
  SetOverwrite on

  ; 0) 如果这个安装目录下的桌宠/控制台正在跑，文件会被锁住 —— 请主人先把她关掉
  ;    （安装器自己不动任何进程，免得误杀另外那只主人的桌宠）
checkrunning:
  IfFileExists "$INSTDIR\electron\electron.exe" 0 notrunning
  ClearErrors
  FileOpen $9 "$INSTDIR\electron\electron.exe" a
  IfErrors locked
  FileClose $9
  Goto notrunning
locked:
  DetailPrint "检测到桌宠还在运行……"
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "桌宠现在还在跑，文件正被占用，装不进去。$\r$\n$\r$\n请先在桌面右下角托盘里右键她 → 退出；如果找不到她，就双击旧安装目录里 standalone 文件夹里的 stop-pet.vbs 把她停掉。$\r$\n$\r$\n关掉之后点「重试」继续安装。" IDRETRY checkrunning
  Abort "安装已取消：请先关掉正在运行的桌宠。"
notrunning:

  ; 1) 铺文件（脚本版安装器不进安装目录 —— 这里有 Uninstall.exe，用不着它们）
  DetailPrint "正在复制文件（约 765 MB，机械硬盘要一两分钟）……"
  SetOutPath "$INSTDIR"
  File /r /x "install.ps1" /x "uninstall.ps1" /x "安装.cmd" /x "卸载.cmd" "${STAGE}\*"

  ; 2) 快捷方式（桌面 + 开始菜单）
  DetailPrint "正在创建快捷方式……"
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\electron\electron.exe" '"$INSTDIR\launcher"' "$INSTDIR\launcher\pet.ico" 0 SW_SHOWNORMAL "" "${APP_NAME} —— 桌面 Q 版蓝发小女仆，双击打开控制台"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\electron\electron.exe" '"$INSTDIR\launcher"' "$INSTDIR\launcher\pet.ico" 0 SW_SHOWNORMAL "" "${APP_NAME} —— 桌面 Q 版蓝发小女仆，双击打开控制台"

  ; 3) 卸载项（「设置 → 应用」里能看到，也能一键卸载）
  DetailPrint "正在登记卸载项……"
  WriteRegStr HKCU "Software\${APP_ID}" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayName"           "${APP_NAME}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayVersion"        "${APP_VER}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Publisher"             "${APP_PUB}"
  WriteRegStr   HKCU "${UNINST_KEY}" "InstallLocation"       "$INSTDIR"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayIcon"           "$INSTDIR\launcher\pet.ico,0"
  WriteRegStr   HKCU "${UNINST_KEY}" "UninstallString"       '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKCU "${UNINST_KEY}" "QuietUninstallString"  '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify"              1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair"              1
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize"         783565
SectionEnd

; ---------------------------------------------------------------- 卸载
Section "Uninstall"
  SetShellVarContext current
  SetDetailsPrint textonly

  ; 0) 还在跑就卸不干净，请主人先关掉（只检查这个安装目录，不碰别的进程）
un_checkrunning:
  IfFileExists "$INSTDIR\electron\electron.exe" 0 un_notrunning
  ClearErrors
  FileOpen $9 "$INSTDIR\electron\electron.exe" a
  IfErrors un_locked
  FileClose $9
  Goto un_notrunning
un_locked:
  DetailPrint "检测到桌宠还在运行……"
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "桌宠还在跑，先把她关掉再卸载。$\r$\n$\r$\n桌面右下角托盘里右键她 → 退出；如果找不到她，就双击安装目录里 standalone 文件夹里的 stop-pet.vbs。$\r$\n$\r$\n关掉之后点「重试」继续卸载。" IDRETRY un_checkrunning
  Abort "卸载已取消：请先关掉正在运行的桌宠。"
un_notrunning:

  ; 1) 快捷方式
  DetailPrint "正在删除快捷方式……"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  ; 2) 卸载项
  DetailPrint "正在清理注册表……"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP_ID}"

  ; 3) 人设/记忆要不要一起删
  IfFileExists "$APPDATA\${APP_ID}\*.*" 0 skipdata
  MessageBox MB_YESNO|MB_ICONQUESTION "要不要连人设、记忆和聊天记录一起删掉？$\r$\n$\r$\n· 选「否」= 只删程序，以后重装她还记得你（推荐）$\r$\n· 选「是」= 连数据一起清干净$\r$\n$\r$\n数据位置：$APPDATA\${APP_ID}" /SD IDNO IDNO skipdata
  DetailPrint "正在删除人设与记忆……"
  RMDir /r "$APPDATA\${APP_ID}"
  skipdata:

  ; 4) 程序本体
  DetailPrint "正在删除程序文件……"
  RMDir /r "$INSTDIR"
SectionEnd
