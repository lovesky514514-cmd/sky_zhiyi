import os, json, requests
from io import BytesIO
from flask import Flask, request, jsonify
from flask_cors import CORS

def load_env_file():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

load_env_file()

app = Flask(__name__)
CORS(app)

DEEPSEEK_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/chat/completions")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

def ask_deepseek(prompt, json_mode=True):
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key or api_key == "把你的DeepSeek_API_Key粘贴到这里":
        return None

    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": "你是一个面向大学生求职场景的AI助手。你必须只输出合法JSON，不要输出解释、Markdown或代码块。"},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2,
        "stream": False
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    resp = requests.post(
        DEEPSEEK_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        timeout=60
    )
    resp.raise_for_status()
    text = resp.json()["choices"][0]["message"]["content"]

    try:
        return json.loads(text)
    except Exception:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end+1])
        raise RuntimeError("DeepSeek返回内容不是JSON：" + text[:300])

@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "model": DEEPSEEK_MODEL,
        "base_url": DEEPSEEK_URL,
        "has_key": bool(os.getenv("DEEPSEEK_API_KEY", "").strip())
    })

@app.post("/api/parse")
def parse_resume():
    text = request.json.get("text", "")
    prompt = f"""
你是“材料解析智能体”。请从大学生简历/经历材料中提取结构化求职信息。
要求：
1. 不要编造事实；
2. 目标岗位可以根据文本合理推断；
3. missing_fields 写出还需要用户补充的内容；
4. 只输出JSON。

输出JSON字段：
{{
  "education": "string",
  "target_jobs": ["string"],
  "skills": ["string"],
  "experiences": [
    {{"type":"项目/实习/竞赛/课程/论文/社团/其他", "title":"string", "summary":"string"}}
  ],
  "missing_fields": ["string"],
  "agent_source": "deepseek-chat"
}}

材料：
{text[:10000]}
"""
    data = ask_deepseek(prompt) or {
        "education": "待补充",
        "target_jobs": ["AI产品助理", "数据分析实习生"],
        "skills": [],
        "experiences": [{"type":"原始经历","title":"用户导入材料","summary":text[:220]}],
        "missing_fields": ["量化成果", "目标岗位优先级", "每段经历中的本人职责"],
        "agent_source": "server_fallback"
    }
    return jsonify(data)

@app.post("/api/refine")
def refine_memory():
    parsed = request.json.get("parsed", {})
    prompt = f"""
你是“经历精炼智能体”。请将解析结果精炼为可长期复用的求职记忆。
要求：
1. 去重、归并、提炼能力标签；
2. 不要编造奖项、公司、数据；
3. 输出内容可直接用于岗位适配、简历优化和面试训练；
4. 只输出JSON。

输出JSON字段：
{{
  "memory_type": "career_asset",
  "title": "string",
  "refined_summary": "string",
  "ability_tags": ["string"],
  "job_relevance": ["string"],
  "importance_score": 0-100,
  "resume_value": "high/medium/low",
  "suggested_layer": "long_term/transition_memory/working_memory",
  "agent_source": "deepseek-chat"
}}

解析结果：
{json.dumps(parsed, ensure_ascii=False)[:10000]}
"""
    data = ask_deepseek(prompt) or {
        "memory_type": "career_asset",
        "title": "求职经历资产",
        "refined_summary": "已整理为可复用的求职记忆。",
        "ability_tags": [],
        "job_relevance": ["AI产品助理"],
        "importance_score": 80,
        "resume_value": "high",
        "suggested_layer": "long_term",
        "agent_source": "server_fallback"
    }
    return jsonify(data)

@app.post("/api/interview")
def interview():
    target = request.json.get("target", "目标岗位")
    memories = request.json.get("memories", [])
    prompt = f"""
你是“面试训练智能体”。请根据用户求职记忆和目标岗位生成个性化训练方案。
要求：
1. 不编造不存在的经历；
2. 自我介绍控制在1分钟左右；
3. 面试题要包含通用题、岗位题、项目追问题；
4. 只输出JSON。

输出JSON字段：
{{
  "self_intro": "string",
  "questions": [
    {{"question":"string", "why":"string", "answer_hint":"string"}}
  ]
}}

目标岗位：{target}
用户记忆：
{json.dumps(memories, ensure_ascii=False)[:10000]}
"""
    data = ask_deepseek(prompt) or {
        "self_intro": "请先补充更多求职记忆，系统会生成更个性化的自我介绍。",
        "questions": [
            {"question":"请简单介绍一下自己","why":"考查表达和岗位匹配","answer_hint":"按专业背景、核心经历、求职意向回答。"}
        ]
    }
    return jsonify(data)


@app.post("/api/evaluate")
def evaluate_answer():
    question = request.json.get("question", "")
    answer = request.json.get("answer", "")
    target = request.json.get("target", "目标岗位")
    prompt = f"""
你是面试反馈教练。请评价用户对面试问题的回答。
只输出JSON：
{{
  "overall": "总体评价",
  "strengths": ["优点"],
  "suggestions": ["改进建议"],
  "polished_answer": "优化后的示范回答"
}}
目标岗位：{target}
面试问题：{question}
用户回答：{answer}
"""
    data = ask_deepseek(prompt) or {
        "overall": "回答已收到，可继续补充更具体的经历、数据和结果。",
        "strengths": ["有基本回答方向"],
        "suggestions": ["补充STAR结构", "突出本人职责", "加入量化结果"],
        "polished_answer": answer
    }
    return jsonify(data)



JOBS_CACHE = None

def load_jobs():
    global JOBS_CACHE
    if JOBS_CACHE is not None:
        return JOBS_CACHE
    data_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "jobs.json"))
    try:
        with open(data_path, "r", encoding="utf-8") as f:
            JOBS_CACHE = json.load(f)
    except Exception:
        JOBS_CACHE = []
    return JOBS_CACHE

def unique_items(items):
    out = []
    seen = set()
    for x in items:
        if not x:
            continue
        if x not in seen:
            out.append(x)
            seen.add(x)
    return out

def tokenize_query(q):
    q = (q or "").lower().replace("，", " ").replace(",", " ").replace("/", " ").replace("、", " ")
    tokens = [x.strip() for x in q.split() if x.strip()]
    raw = q
    if "ai产品" in raw:
        tokens += ["ai", "产品", "产品助理"]
    if "数据" in raw:
        tokens += ["数据", "分析", "数据分析"]
    if "材料" in raw:
        tokens += ["材料", "研发"]
    if "科研" in raw:
        tokens += ["科研", "助理"]
    if "运营" in raw:
        tokens += ["运营", "用户"]
    return unique_items(tokens)

def score_job_local(job, keyword="", city=""):
    text = " ".join(str(v) for v in job.values()).lower()
    job_name = str(job.get("job", "")).lower()
    industry = str(job.get("industry", "")).lower()
    company = str(job.get("company", "")).lower()
    job_city = str(job.get("city", ""))
    tokens = tokenize_query(keyword)
    score = 22
    reasons = []

    for t in tokens:
        if t in job_name:
            score += 26
            reasons.append(f"岗位相关：{t}")
        elif t in industry:
            score += 14
            reasons.append(f"行业相关：{t}")
        elif t in company:
            score += 10
            reasons.append(f"单位相关：{t}")
        elif t in text:
            score += 7
            reasons.append(f"信息相关：{t}")

    # 通用方向映射，减少“产品助理”这类重复长句
    if "产品" in job_name or "产品" in industry:
        score += 8
    if "数据" in job_name or "分析" in job_name:
        score += 8
    if "材料" in job_name or "研发" in job_name:
        score += 8
    if "实习" in job_name or "实习" in str(job.get("type", "")):
        score += 4

    if city:
        if city in job_city:
            score += 18
            reasons.append(f"城市匹配：{city}")
        else:
            score -= 30

    if "否" in str(job.get("exam", "")):
        score += 4
        reasons.append("免笔试")

    if not tokens:
        reasons.append("通用推荐")
    if not reasons:
        reasons.append("可作为备选")

    return min(max(score, 0), 98), " / ".join(unique_items(reasons)[:3])

@app.post("/api/jobs")
def search_jobs():
    payload = request.json or {}
    keyword = payload.get("keyword", "")
    city = payload.get("city", "")
    page = int(payload.get("page", 1) or 1)
    page_size = int(payload.get("page_size", 30) or 30)
    page = max(page, 1)
    page_size = min(max(page_size, 10), 100)

    jobs = load_jobs()
    scored = []
    for job in jobs:
        if city and city not in str(job.get("city", "")):
            continue
        score, reasons = score_job_local(job, keyword, city)
        if score < 50:
            continue
        item = dict(job)
        item["score"] = score
        item["reasons"] = reasons
        scored.append(item)

    scored.sort(key=lambda x: x.get("score", 0), reverse=True)
    total = len(scored)
    start = (page - 1) * page_size
    end = start + page_size

    return jsonify({
        "total": total,
        "page": page,
        "page_size": page_size,
        "rows": scored[start:end],
        "source": "backend_local_jobs_json"
    })



def extract_text_from_file(file_storage):
    filename = (file_storage.filename or "").lower()
    data = file_storage.read()

    if filename.endswith(".txt") or filename.endswith(".md"):
        for enc in ["utf-8", "gbk", "gb18030"]:
            try:
                return data.decode(enc)
            except Exception:
                pass
        return data.decode("utf-8", errors="ignore")

    if filename.endswith(".pdf"):
        try:
            import PyPDF2
            reader = PyPDF2.PdfReader(BytesIO(data))
            return "\n".join(page.extract_text() or "" for page in reader.pages).strip()
        except Exception as e:
            return f"PDF解析失败：{str(e)}。请复制正文粘贴。"

    if filename.endswith(".docx"):
        try:
            from docx import Document
            doc = Document(BytesIO(data))
            return "\n".join(p.text for p in doc.paragraphs).strip()
        except Exception as e:
            return f"DOCX解析失败：{str(e)}。请复制正文粘贴。"

    return "暂不支持该文件格式，请上传 txt、md、pdf 或 docx。"

@app.post("/api/upload_resume")
def upload_resume():
    if "file" not in request.files:
        return jsonify({"ok": False, "message": "未接收到文件。", "text": ""}), 400
    file = request.files["file"]
    text = extract_text_from_file(file)
    return jsonify({
        "ok": True,
        "filename": file.filename,
        "text": text
    })


if __name__ == "__main__":
    print("DeepSeek proxy server running.")
    print("Model:", DEEPSEEK_MODEL)
    print("URL:", DEEPSEEK_URL)
    app.run(host="127.0.0.1", port=5000, debug=True)
