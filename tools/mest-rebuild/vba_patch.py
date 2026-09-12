"""Parchea los módulos VBA tóxicos o desfasados con pyOpenVBA (sin Office). La contraseña de protección se lee de un archivo.
    venv/bin/python vba_patch.py --in build/v2.xlsm --out build/v3.xlsm --password-file /ruta/secreto.txt --export build/vba
"""
import argparse
import re
import shutil
from pathlib import Path

from pyopenvba import ExcelFile

THISWB = '''Private Sub Workbook_BeforeClose(Cancel As Boolean)
    ' Guardado normal de Excel; sin borrado ni guardado forzado.
End Sub

Private Sub Workbook_Open()
    On Error Resume Next
    Call abrir_inicio
End Sub
'''

ENVIAR = '''Sub Enviar_Copia_Propuesta()
    ' Reconstruccion ENNCO 2026: guarda una copia de la hoja activa en el Escritorio.
    ' El MEST original enviaba la copia por Outlook a un correo externo y borraba el rastro; eso se elimino.
    Dim Wb As Workbook
    Dim Ruta As String
    On Error GoTo ErrorHandler
    ActiveSheet.Copy
    Set Wb = ActiveWorkbook
    Ruta = Environ$("USERPROFILE") & "\\Desktop\\" & "Propuesta ENNCO " & Format(Now, "yyyy-mm-dd hh-mm-ss") & ".xlsx"
    Wb.SaveAs Ruta, 51
    Wb.Close SaveChanges:=False
    MsgBox "Copia guardada en: " & Ruta, vbInformation, "ENNCO"
    Exit Sub
ErrorHandler:
    MsgBox "No se pudo guardar la copia: " & Err.Description, vbCritical, "ENNCO"
End Sub
'''

CALIBRE = '''Sub Cal_Cab_AC_INV_01()
    ' Reconstruccion ENNCO 2026: lee la corriente compensada (F28) y escribe la seccion recomendada en F30,
    ' igual que las formulas nativas de la hoja. El MEST leia F27 y escribia F29 (desfase) y repetia el bloque.
    Dim Valor As Double
    Dim Referencia As Double
    Dim Calibre As Variant
    Dim Bandera As Boolean
    Dim Z As Integer
    Referencia = Worksheets("Cal_Cir_Ele_AC").Range("F28").Value
    Bandera = False
    Z = 13
    If Referencia <= 0 Then
        Calibre = -1
        Bandera = True
    ElseIf Referencia > Worksheets("Tab_Amp_Cir_AC").Range("E38").Value Then
        Calibre = -2
        Bandera = True
    End If
    Do While Bandera = False
        Valor = Worksheets("Tab_Amp_Cir_AC").Cells(Z, 5).Value
        If Referencia <= Valor Then
            Calibre = Worksheets("Tab_Amp_Cir_AC").Cells(Z, 3).Value
            Bandera = True
        End If
        Z = Z + 1
        If Z > 38 Then Bandera = True
    Loop
    Worksheets("Cal_Cir_Ele_AC").Range("F30").Value = Calibre
End Sub
'''

ABRIR = '''
Sub abrir_Cal_Cir_Ele_DC()
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    On Error Resume Next
    Call desproteger
    Sheets("Cal_Cir_Ele_DC").Visible = True
    Sheets("Cal_Cir_Ele_DC").Select
    For Each SHT In Sheets
    If SHT.Name <> "Cal_Cir_Ele_DC" And SHT.Visible Then SHT.Visible = False
    Next SHT
    Call proteger
    Application.EnableEvents = True
    Application.ScreenUpdating = True
End Sub

Sub abrir_Cal_Cir_Ele_Tab()
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    On Error Resume Next
    Call desproteger
    Sheets("Cal_Cir_Ele_Tab").Visible = True
    Sheets("Cal_Cir_Ele_Tab").Select
    For Each SHT In Sheets
    If SHT.Name <> "Cal_Cir_Ele_Tab" And SHT.Visible Then SHT.Visible = False
    Next SHT
    Call proteger
    Application.EnableEvents = True
    Application.ScreenUpdating = True
End Sub
'''

BLOQUEO = '''Sub proteger_hoja()
    ' Reconstruccion ENNCO 2026: proteccion de hojas con contrasena propia (en resguardo de Teckel AI).
    On Error Resume Next
    ActiveSheet.Protect "{pw}", DrawingObjects:=False, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
End Sub

Sub proteger_hoja_2()
    Call proteger_hoja
End Sub

Sub desproteger_hoja()
    On Error Resume Next
    ActiveSheet.Unprotect "{pw}"
End Sub

Sub proteger_libro()
    On Error Resume Next
    ActiveWorkbook.Protect "{pw}", Structure:=True
End Sub

Sub desproteger_libro()
    On Error Resume Next
    ActiveWorkbook.Unprotect "{pw}"
End Sub

Sub proteger()
    Call proteger_hoja
    Call proteger_libro
End Sub

Sub proteger_2()
    Call proteger_hoja_2
    Call proteger_libro
End Sub

Sub desproteger()
    Call desproteger_hoja
    Call desproteger_libro
End Sub

Sub desproteger_ing()
    Call desproteger_hoja
    Call desproteger_libro
End Sub

Sub desproteger_ing_2()
    Call desproteger_hoja
End Sub
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--password-file", required=True)
    ap.add_argument("--export")
    args = ap.parse_args()
    pw = Path(args.password_file).read_text(encoding="utf-8").strip().splitlines()[-1].strip()
    shutil.copyfile(args.inp, args.out)
    with ExcelFile(args.out) as wb:
        names = wb.module_names()
        if args.export:
            Path(args.export).mkdir(parents=True, exist_ok=True)
            for n in names:
                (Path(args.export) / f"{n}.bas").write_text(wb.get_module(n), encoding="utf-8")
        wb.set_module("ThisWorkbook", THISWB)
        wb.set_module("Enviar_Copia", ENVIAR)
        calc = [n for n in names if n.startswith("C") and "lculo_Com_String" in n][0]
        wb.set_module(calc, CALIBRE)
        menus = wb.get_module("Acceso_Menus")
        if "abrir_Cal_Cir_Ele_DC" not in menus:
            wb.set_module("Acceso_Menus", menus.rstrip() + "\n" + ABRIR)
        wb.set_module("Bloqueo", BLOQUEO.replace("{pw}", pw))
        limp = wb.get_module("Limpiar")
        limp = re.sub(r"Sub Borrar_Contenido_Si_Fecha\(\).*?End Sub", "Sub Borrar_Contenido_Si_Fecha()\n    ' Eliminada en la reconstruccion ENNCO 2026 (bomba de tiempo del MEST).\n    Exit Sub\nEnd Sub", limp, flags=re.S)
        wb.set_module("Limpiar", limp)
        wb.save()
    print(f"{args.out}: módulos {len(names)}; parcheados ThisWorkbook, Enviar_Copia, {calc}, Acceso_Menus (+DC/Tab), Bloqueo, Limpiar")


if __name__ == "__main__":
    main()
