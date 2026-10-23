# Windows 11 Pro дээр суулгах, засварлах

Энэ заавар нь `forensic-api`, `forensic-frontend` хоёр Git checkout-ыг Windows
компьютерт ажиллуулж, Edge/Chrome хөтчөөс ашиглах суулгалтад зориулагдсан.

## Шаардлага

- Node.js **22 LTS, 22.12 буюу түүнээс шинэ 22.x**, эсвэл **24 LTS**, **x64**.
  32 бит Node болон дэмжигдээгүй хувилбаруудыг асаалт шалгаад зогсооно.
  Windows ARM компьютерт мөн x64 Node суулгаж Windows-ийн x64 emulation ашиглана.
- Git for Windows; Node, Git хоёрыг PATH-д нэмсэн байх.
- pnpm 10: Command Prompt нээгээд `npm.cmd install -g pnpm@10.34.7` ажиллуулна.
- Эхний суулгалт, шинэчлэлтэд Git remote болон npm сангуудад хүрэх интернэт.

Node эсвэл PATH өөрчилсний дараа терминалаа хааж дахин нээнэ. Автомат асаалтад
шинэ PATH хэрэглэхийн тулд Windows-оос sign out хийгээд дахин нэвтэрнэ.
PowerShell ExecutionPolicy-г бүх компьютерт өөрчлөх, VBScript идэвхжүүлэх,
админаар байнга ажиллуулах шаардлагагүй. Байгууллагын Group Policy скрипт
ажиллуулахыг хориглосон бол тухайн байгууллагын администраторт хандана.

## Одоо байгаа суулгалтыг шинэчлэх

Хоёр checkout нэг хавтас дотор зэрэгцээ байна:

```text
C:\Murch\forensic-api\
C:\Murch\forensic-frontend\
```

1. Checkout-уудын кодыг шинэчилнэ. Хуучин updater ажиллахгүй байвал тус бүрийн
   хавтсанд Command Prompt нээгээд `git pull --ff-only` ажиллуулна.
2. Аль нэг checkout-ын `scripts\update-all.bat` файлыг ажиллуулна. Энэ нь
   хоёуланг шинэчилж, сангуудыг lockfile-оор суулган, backend migration болон
   frontend build-ийг ажиллуулна. Өмнө ажиллаж байсан серверүүдийг дахин асаана.
3. **Хоёр checkout тус бүрт** `scripts\install-startup-windows.bat` ажиллуулна.
   Ингэснээр хуучин `.vbs`/`.bat` Startup бичлэг шинэ `.lnk`-ээр солигдоно.
   Энэ алхмыг хуучин автомат асаалттай компьютерт нэг удаа заавал хийнэ.
4. `http://localhost:5173` хаягийг Edge/Chrome-оор нээнэ.

Автомат асаалт Windows-д хэрэглэгч нэвтэрсний дараа ажиллана. Лог нь
checkout бүрийн `logs\startup.log` файлд хадгалагдана. Шууд гараар асаахад
`scripts\start-windows.bat` ашиглана. Давхар шинэ launcher нэг checkout-ыг
хоёр удаа асаахгүй.

**Одоо байгаа `.env`, `data` хавтас болон мэдээллийн сангаа устгахгүй.**
Өгөгдлийн сангийн тохиргоог энэ засвар солихгүй. Ажиллаж буй өгөгдлийн сангийн
байршлыг өөрчилж шинэ хоосон сан руу зааж болохгүй.

## Алдаа гарвал

| Алдаа | Засах алхам |
| --- | --- |
| Node.js / pnpm not found, unsupported Node | Дээрх x64 Node LTS, pnpm 10 суулган терминалаа дахин нээнэ. |
| Native module / NODE_MODULE_VERSION / SQLite binding | Node хувилбараа зассаны дараа бүх Forensic серверийг хааж, API хавтсанд `pnpm rebuild better-sqlite3 sharp esbuild`, дараа нь `scripts\start-windows.bat` ажиллуулна. Дахин алдахад install логийг шалгана. |
| Migration failed | Логийн эхний migration алдааг шалгана. Санг устгах, rollback хийхгүй; алдааны логийг өгнө. |
| EADDRINUSE / port already in use | Ижил серверийг өөр терминалаас давхар асаасан эсэхийг шалгана. Бусад програмын бүх `node.exe` процессыг нийтээр нь хаахгүй. |
| Хуудас нээгдээд API холбогдохгүй | Backend лог болон `http://localhost:4000/health`-ийг шалгана (`PORT` өөрчилсөн бол тэр портоо ашиглана). Frontend `.env` дэх `API_URL`/`API_PORT` нь бодит backend-тэй таарч байх ёстой. |
| LAN-аас нээгдэхгүй | Эхлээд серверийн өөрийн localhost дээр ажиллаж буйг шалгаад, Windows Firewall-ийн байгууллагын зөвшөөрөгдсөн сүлжээний дүрмийг администратороор тохируулуулна. |

Frontend build `dist/.commit`-оор шинэ эсэхээ шалгана. Шинэ build эсвэл migration
алдахад хуучин дэлгэцийг амжилттай шинэчилсэн мэтээр үргэлжлүүлэхгүй.

Оношлоход Command Prompt-д `node -v`, `node -p process.arch`, `pnpm.cmd -v`
ажиллуулж үр дүнг болон **хоёр checkout-ын `logs\startup.log` дахь сүүлийн алдааг**
өгнө. `.env`, нууц үг, token болон мэдээллийн сангийн файлыг явуулахгүй.

## Хөгжүүлэгчийн шалгалт

```powershell
node --test tests/runtimeCheck.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/windowsRuntime.ps1
```

GitHub Actions-ийн `Windows startup` нь Windows runner дээр Node 22/24,
Windows PowerShell 5.1 ашиглан native dependencies, тусгаарласан migration,
build, бодит серверийн HTTP асаалт болон процесс хаалтыг шалгана.
Туршилтын сан нь runner-ийн түр хавтсанд байна; хэрэглэгчийн санг ашиглахгүй.
