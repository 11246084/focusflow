# ============================================================
# focusflow — 寫入 video_segments
# 執行方式：python import_video_segments.py
# 放置位置：專案根目錄
# 資料來源：
#   chunks.jsonl     ← course_name, week, lesson
#   embeddings.jsonl ← embedding 向量
#
# ⚠️ transcripts_normalized 已獨立成自己的 collection，不在這裡處理
# ============================================================

import json
from pymongo import MongoClient

MONGODB_URI = "mongodb+srv://11246084:11246084@focusflow.gw8l4ke.mongodb.net/focusflow"

client = MongoClient(MONGODB_URI)
db = client["focusflow"]
print("✅ 成功連線 MongoDB")

# ============================================================
# 第一步：讀取 chunks.jsonl
# key = chunk_id
# ============================================================
print("\n📂 讀取 chunks.jsonl...")

chunks_lookup = {}
with open("data/outputs/chunks.jsonl", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        chunk = json.loads(line)
        chunks_lookup[chunk["chunk_id"]] = {
            "course_name": chunk.get("course_name", None),
            "week":        chunk.get("week", None),
            "lesson":      chunk.get("lesson", None),
        }

print(f"✅ 載入 {len(chunks_lookup)} 筆 chunks 資料")

# ============================================================
# 第二步：讀取 embeddings.jsonl，合併 chunks 資料
# ============================================================
print("\n📂 讀取 embeddings.jsonl 並合併...")

segment_documents = []
match_count = 0
no_match_count = 0

with open("data/outputs/embeddings.jsonl", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        emb = json.loads(line)

        chunk_extra = chunks_lookup.get(emb["chunk_id"], {})
        if chunk_extra:
            match_count += 1
        else:
            no_match_count += 1

        segment_documents.append({
            "chunk_id":    emb["chunk_id"],
            "video_id":    emb["video_id"],
            "courseId":    None,
            "course_name": chunk_extra.get("course_name", None),
            "week":        chunk_extra.get("week", None),
            "lesson":      chunk_extra.get("lesson", None),
            "startSec":    emb["start_sec"],
            "endSec":      emb["end_sec"],
            "transcript":  emb["text"],
            "embedding":   emb["embedding"],
        })

print(f"✅ 合併完成，共 {len(segment_documents)} 筆")
print(f"   → 成功對應 chunks：{match_count} 筆")
if no_match_count > 0:
    print(f"   ⚠️  未對應到 chunks：{no_match_count} 筆")

# ============================================================
# 第三步：清空並重新寫入 video_segments
# ============================================================
print("\n📥 清空並寫入 video_segments...")

db.video_segments.delete_many({})

if segment_documents:
    db.video_segments.insert_many(segment_documents)

total = db.video_segments.count_documents({})
print(f"✅ 寫入完成！video_segments 目前共 {total} 筆")
print("\n⚠️  注意：courseId 目前為 null，之後建立 courses 資料後再更新！")

client.close()