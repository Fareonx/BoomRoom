# 💣 İki Otaq və Bomba (Two Rooms and a Boom) — Azərbaycan dilində Web / Party Oyunu

Smartfonlar və kompüterlər üçün nəzərdə tutulmuş, gizli rollar və psixoloji gərginliklə dolu onlayn və canlı partiya oyunu.

---

## 🌟 Əsas Xüsusiyyətlər və Qaydalar

- **Tam Azərbaycan dilində:** bütün interfeys, rollar, təsvirlər və sistem bildirişləri doğma dilimizdədir.
- **Gizli Otaq Çatı (Otaq A və Otaq B):**
  - Hər otağın özünəməxsus daxili çatı var.
  - Otaq A-da yazılanları yalnız Otaq A-dakılar, Otaq B-də yazılanları yalnız Otaq B-dəkilər oxuyur.
  - Girov dəyişikliyi zamanı başqa otağa keçən oyunçu avtomatik olaraq yeni otağın çatına qoşulur!
- **Rollar və Psixoloji Taktikalar:**
  - 🛡️ **Prezident (Mavilər):** məqsədi 3-cü raundun sonunda Bombist OLMAYAN otaqda olmaqdır.
  - 💣 **Bombist (Qırmızılar):** məqsədi partlayış zamanı Prezidentlə EYNİ otaqda olmaqdır.
  - 🕵️ **Qırmızı Casus:** Qırmızı komandanın üzvüdür, lakin Rəng Paylaşımında onun rəngi **MAVİ** yanır!
  - 🕵️ **Mavi Casus:** Mavi komandanın üzvüdür, lakin Rəng Paylaşımında onun rəngi **QIRMIZI** yanır!
  - 🤐 **Utancaq:** kartını və ya rəngini heç kimə göstərə bilməz (düymələr bloklanıb). Digər şübhəli oyunçular da özlərini Utancaq kimi göstərib yalan danışa bilər!
  - 🔍 **Agent:** hər raundda bir dəfə öz otağındakı istənilən oyunçunu məcburi dindirib kartına baxa bilər (əgər hədəf Utancaq deyilsə).
- **Rəqəmsal Əl Sıxma (Handshake):**
  - Otağınızdakı bir və ya bir neçə dostunuzu seçib onlara **«Rəngi göstər»** və ya **«Kartı göstər»** təklifi göndərə bilərsiniz.
- **Səs Efektləri (Web Audio API):**
  - Taymerin son saniyələrinin döyüntüsü, kart vərəqləmə, həyəcan siqnalı və qələbə/partlayış səsləri.

---

## 🚀 Kompüterdə Lokal İcra (Evdə Wi-Fi ilə oynamaq üçün)

1. Terminalda layihə qovluğuna daxil olun:
   ```bash
   cd "C:\Users\FeNiNi\.gemini\antigravity\scratch\two-rooms-and-a-boom"
   npm install
   npm start
   ```
2. Brauzerdə açın: `http://localhost:3000`
3. **Dostlarınızın telefonla qoşulması üçün:**
   - Kompüterinizin lokal IP ünvanını öyrənin (`ipconfig` əmrini yazın, məsələn: `192.168.1.15`).
   - Eyni Wi-Fi-ya qoşulmuş dostlarınız telefon brauzerində bu ünvana daxil olurlar: `http://192.168.1.15:3000`.

---

## 🐙 Layihəni GitHub-a necə yükləmək olar? (Addım-addım)

1. [github.com](https://github.com) saytına daxil olun və hesabınıza daxil olun.
2. Yuxarı sağ küncdə **+** düyməsini sıxıb **New repository** seçin.
3. Repository name yerinə ad yazın: məsələn `iki-otaq-ve-bomba`.
4. **Public** və ya **Private** seçin və **Create repository** düyməsinə klikləyin.
5. Açılan səhifədəki linki kopyalayın (məsələn: `https://github.com/SİZİN_İSTİFADƏÇİ_ADINIZ/iki-otaq-ve-bomba.git`).
6. Kompüterinizdə terminalı (PowerShell) açıb bu əmrləri icra edin:

```bash
cd "C:\Users\FeNiNi\.gemini\antigravity\scratch\two-rooms-and-a-boom"
git add .
git commit -m "feat: tam azerbaycan dilinde iki otaq ve bomba oyunu ve otaq cati"
git branch -M main
git remote add origin https://github.com/SİZİN_İSTİFADƏÇİ_ADINIZ/iki-otaq-ve-bomba.git
git push -u origin main
```
Artıq layihəniz bütünlüklə GitHub-dadır!

---

## ☁️ İnternetdə Pulsuz Yerləşdirmə (Render.com)

Dostlarınız fərqli evlərdədirsə (onlayn oynamaq üçün):
1. [render.com](https://render.com) saytına GitHub ilə daxil olun.
2. **New +** $\rightarrow$ **Web Service** seçin və `iki-otaq-ve-bomba` reponuzu bağlayın.
3. Ayarlar:
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. **Deploy** vurun — 1 dəqiqəyə sizə internet linki veriləcək (məsələn: `https://iki-otaq-ve-bomba.onrender.com`).
