"""Download consented AstroVital calibration CSVs after stopping recording.

Stores files only on the authorized Windows workstation. Does not delete
or alter the Raspberry Pi originals. No credentials are embedded.
"""
from pathlib import Path
from urllib.request import urlopen
import json
import os
import paramiko
import re

PI="192.168.10.1"
REMOTE="/home/mustafa/astrovital/backend/data/calibration_sessions"
LOCAL=Path.home()/"Downloads"/"AstroVital_Kalibrasyon_CSV"

with urlopen(f"http://{PI}:8000/api/v1/calibration/status",timeout=6) as response:
    status=json.load(response)
if status.get("active"):
    raise SystemExit("CSV indirmeden once dashboard'da oturumu durdurun.")
print("Oturum:",status.get("phase"),"| Son dosya:",status.get("csv_filename"))

ssh=paramiko.SSHClient()
ssh.load_host_keys(str(Path.home()/".ssh"/"known_hosts"))
ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
ssh.connect(PI,username="mustafa",
            key_filename=str(Path.home()/".ssh"/"astrovital_pi"),
            look_for_keys=False,allow_agent=False,timeout=8)
try:
    with ssh.open_sftp() as sftp:
        try:
            files=sftp.listdir_attr(REMOTE)
        except FileNotFoundError:
            print("Henüz CSV kaydı yok: oturum başlatılmamış.")
            raise SystemExit(0)
        allowed=[f for f in files if re.fullmatch(
            r"session_\d{8}T\d{6}Z_[0-9a-f]{16}\.csv",f.filename)]
        if not allowed:
            print("Henüz kaydedilmiş kalibrasyon CSV'si yok.")
            raise SystemExit(0)
        LOCAL.mkdir(parents=True,exist_ok=True)
        for file in sorted(allowed,key=lambda x:x.filename):
            final=LOCAL/file.filename
            if final.exists() and final.stat().st_size==file.st_size:
                print("Zaten mevcut:",file.filename)
                continue
            tmp=LOCAL/(file.filename+".partial")
            sftp.get(REMOTE+"/"+file.filename,str(tmp))
            if tmp.stat().st_size!=file.st_size:
                tmp.unlink(missing_ok=True)
                raise RuntimeError("Eksik dosya kopyası: "+file.filename)
            os.replace(tmp,final)
            print("INDIRILDI:",str(final),file.st_size,"bayt")
finally:
    ssh.close()
print("CSV aktarma tamamlandi. Olcum verilerini izinsiz paylasmayin.")
