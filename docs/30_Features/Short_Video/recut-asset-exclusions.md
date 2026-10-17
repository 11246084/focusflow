# recut 素材開放與排除清單

這份清單決定 recut 短片的 AI 可以從 Fluent Emoji 裡挑哪些圖、不能挑哪些圖。Fluent Emoji 有 1,595 個物件，一個一個核准太花時間，所以改成「整類開放，再排除不適合教學的」（[設計決策](recut-design-decisions.md)第 24 項）。本清單已於 2026-10-17 核准，實作時轉成程式讀的 JSON；之後要增減，改這份檔案並記錄日期。

## 名詞

- **Fluent Emoji**：Microsoft 的開源表情符號圖庫，MIT 授權；我們只用扁平版（Flat）、保留原色。
- **類別**：Fluent 每個物件附帶的分類（例如 Objects、Food & Drink），來自 Unicode 的 emoji 分類。
- **開放清單**：AI 寫施工單時能選的物件名稱；不在清單裡的，程式驗證時直接擋下。

## 規則（例）

AI 想在「需求增加 → 價格上升」的流程圖裡放 `Money bag`（錢袋）→ 它屬於 Objects 類別、不在排除清單 → 可以用。
AI 想放 `Wine glass`（酒杯）→ 在排除清單 → 驗證失敗，退回第二步重選。

1. **整類開放**：Objects、Travel & Places、Animals & Nature、Food & Drink、Activities、People & Body、Smileys & Emotion，扣掉下方排除的物件。
2. **Symbols（符號）不整類開放**：箭頭、勾叉、加減號已由 Phosphor 圖示和文字負責，其餘多是介面按鈕；只開放下方 28 個。
3. **Flags（旗幟）全部不開放**：8 個。
4. **人物只用預設黃色膚色**（310 個有膚色版本的物件只取 Default），不用 3D、彩色、高對比等其他風格。

依 2026-10-17 讀到的 Fluent 分類資料計算：開放 1,341 個、排除 51＋195＋8 個。

## 排除（51 個）

| 原因 | 物件 |
|---|---|
| 武器與暴力（6） | Bomb 炸彈、Dagger 匕首、Crossed swords 交叉的劍、Water pistol 水槍、Bow and arrow 弓箭、Military helmet 軍盔 |
| 死亡（4） | Coffin 棺材、Funeral urn 骨灰罈、Skull 骷髏頭、Skull and crossbones 骷髏與交叉骨 |
| 菸酒與賭博（11） | Cigarette 香菸、Beer mug 啤酒杯、Clinking beer mugs 乾杯啤酒、Wine glass 酒杯、Cocktail glass 雞尾酒、Tropical drink 熱帶飲料、Tumbler glass 威士忌杯、Sake 清酒、Bottle with popping cork 開香檳、Clinking glasses 乾杯、Slot machine 吃角子老虎 |
| 不雅、性暗示與親密（15） | Middle finger 比中指、Face with symbols on mouth 罵髒話的臉、Pile of poo 便便、Face vomiting 嘔吐的臉、Eggplant 茄子、Peach 桃子、Kiss mark 唇印、Face blowing a kiss 飛吻、Kissing face 親吻的臉（含 Kissing face with smiling eyes、Kissing face with closed eyes、Kissing cat 共 4 個）、Bikini 比基尼、Briefs 內褲、Tongue 舌頭 |
| 恐怖形象（8） | Ogre 鬼、Goblin 天狗、Zombie 殭屍（Person／Man／Woman 共 3 個）、Vampire 吸血鬼（Person／Man／Woman 共 3 個） |
| 宗教場所與用品（7） | Church 教堂、Mosque 清真寺、Synagogue 猶太會堂、Hindu temple 印度教寺廟、Kaaba 卡巴天房、Shinto shrine 神社、Prayer beads 念珠 |

茄子與桃子本身是食物，但在網路上常有性暗示，學生族群容易誤解，所以排除；需要時可改用其他蔬果。

## Symbols 只開放這 28 個

| 用途 | 物件 |
|---|---|
| 科學與安全 | Atom symbol 原子、Biohazard 生物危害、Radioactive 輻射、Recycling symbol 回收、Warning 警告、Prohibited 禁止、No entry 禁止進入、Medical symbol 醫療、Potable water 飲用水、Non-potable water 非飲用水 |
| 生物 | Male sign 雄性、Female sign 雌性、A／B／AB／O button blood type 血型（4 個） |
| 強調 | Red question mark 問號、Red exclamation mark 驚嘆號、Exclamation question mark 驚嘆問號、Sparkle 閃亮、Infinity 無限 |
| 經濟與科技 | Heavy dollar sign 錢號、Currency exchange 換匯、Wireless 無線、Antenna bars 訊號 |
| 智慧財產 | Copyright 著作權、Registered 註冊商標、Trade mark 商標 |

其餘 195 個不開放，包括：箭頭與勾叉、幾何色塊、鍵帽數字、播放控制鍵、日文按鈕、12 星座與蛇夫座、宗教符號（十字架、新月、大衛之星、法輪、陰陽、唵等）、和平符號，以及性別認同符號。宗教、政治與身分象徵不給 AI 自動挑選，是為了避免在無關的主題裡誤用；課程真的需要時再個別開放。

## 特別開放的人物（5 個）

Person／Man／Woman wearing turban 戴頭巾的人（3 個）、Woman with headscarf 戴頭巾的女性、Person with skullcap 戴小圓帽的人：服裝和特定宗教有關，但他們是一般人物，排除等於把穿這些服裝的人當成敏感內容，所以開放；AI 挑得不恰當時，由教師在預覽換掉。

## 授權紀錄

- 來源：Microsoft Fluent Emoji（`microsoft/fluentui-emoji`，MIT），透過 npm 套件 `@iconify-json/fluent-emoji-flat` 安裝，版本在實作時固定（2026-10-17 查到最新為 1.2.6）。
- Phosphor 圖示：`@phosphor-icons/core`，MIT。
- 核准：Weihao，2026-10-17（照草案核准，5 個人物開放）。
