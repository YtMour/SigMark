import zipfile, shutil, os
d = r'D:\SigMark\output\fakemagisk'
shutil.copyfile(os.path.join(d,'base.apk'), os.path.join(d,'withdex.apk'))
with zipfile.ZipFile(os.path.join(d,'withdex.apk'),'a',zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(d,'dexout','classes.dex'), 'classes.dex')
print([i.filename for i in zipfile.ZipFile(os.path.join(d,'withdex.apk')).infolist()])