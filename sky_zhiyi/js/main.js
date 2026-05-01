const USE_DEEPSEEK_PROXY = true;
const API_BASE = "http://127.0.0.1:5000";

const state = {
  page: "home",
  step: 0,
  captchaA: 0,
  captchaB: 0,
  currentUser: null,
  parsed: null,
  memories: JSON.parse(localStorage.getItem("sky_zhiyi_memories_v7") || "[]"),
  jobs: [],
  matchedJobs: [],
  jobTotal: 0,
  jobPage: 1,
  pageSize: 30,
  lastJobKeyword: "",
  lastJobCity: "",
  jobSearchMode: "backend",
  questions: [],
  currentQuestions: [],
  currentInterviewTarget: ""
};

const $ = (id) => document.getElementById(id);

async function postJSON(url, payload) {
  const resp = await fetch(API_BASE + url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload || {})
  });
  if (!resp.ok) throw new Error(await resp.text());
  return await resp.json();
}

async function uploadResumeFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const resp = await fetch(API_BASE + "/api/upload_resume", {
    method: "POST",
    body: formData
  });
  if (!resp.ok) throw new Error(await resp.text());
  return await resp.json();
}
async function evaluateAnswerWithDeepSeek(question, answer, target) {
  if (!USE_DEEPSEEK_PROXY) return null;
  return await postJSON("/api/evaluate", {question, answer, target});
}

async function parseWithDeepSeek(text) {
  if (!USE_DEEPSEEK_PROXY) return parseMaterial(text);
  return await postJSON("/api/parse", {text});
}
async function refineWithDeepSeek(parsed) {
  if (!USE_DEEPSEEK_PROXY) return refine(parsed);
  return await postJSON("/api/refine", {parsed});
}
async function interviewWithDeepSeek(target, memories) {
  if (!USE_DEEPSEEK_PROXY) return null;
  return await postJSON("/api/interview", {target, memories});
}
async function searchJobs(keyword, city, page = 1) {
  // 正常模式：后端本地读取 jobs.json，分页返回，避免浏览器一次性加载 9738 条。
  try {
    const result = await postJSON("/api/jobs", {
      keyword,
      city,
      page,
      page_size: state.pageSize
    });
    state.jobTotal = result.total || 0;
    state.jobPage = result.page || page;
    state.matchedJobs = result.rows || [];
    state.jobSearchMode = "backend";
    return result;
  } catch (e) {
    // 备用模式：只有后端没开时才尝试浏览器读取。建议比赛使用务必先开后端。
    const resp = await fetch("data/jobs.json");
    const jobs = await resp.json();
    const scored = jobs
      .filter(j => !city || String(j.city || "").includes(city))
      .map(j => {
        const s = scoreJob(j, keyword, city);
        return {...j, score: s.score, reasons: s.reasons};
      })
      .filter(j => Number(j.score) >= 50)
      .sort((a, b) => b.score - a.score);
    state.jobTotal = scored.length;
    state.jobPage = page;
    state.matchedJobs = scored.slice((page - 1) * state.pageSize, page * state.pageSize);
    state.jobSearchMode = "browser_fallback";
    return {total: scored.length, page, page_size: state.pageSize, rows: state.matchedJobs};
  }
}

function showPage(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active-page"));
  $("page-" + page).classList.add("active-page");
  document.querySelectorAll(".nav-link").forEach(n => n.classList.toggle("active", n.dataset.page === page));
  window.scrollTo({top: 0, behavior: "smooth"});
  if (page === "memory") renderMemories();
  if (page === "jobs") renderJobs(state.matchedJobs);
  if (mainNav) mainNav.classList.remove("show");
}
document.querySelectorAll("[data-page]").forEach(el => el.addEventListener("click", () => showPage(el.dataset.page)));

const menuBtn = $("menuBtn");
const mainNav = $("mainNav");
if (menuBtn && mainNav) {
  menuBtn.addEventListener("click", () => mainNav.classList.toggle("show"));
}

const fadeItems = document.querySelectorAll(".fade-in");
function showOnScroll() {
  fadeItems.forEach(item => {
    const rect = item.getBoundingClientRect();
    if (rect.top < window.innerHeight - 60) item.classList.add("show");
  });
}
window.addEventListener("scroll", showOnScroll);
window.addEventListener("load", showOnScroll);

function saveMemories() {
  localStorage.setItem("sky_zhiyi_memories_v7", JSON.stringify(state.memories));
  renderMemories();
}

function setCaptcha() {
  state.captchaA = Math.floor(Math.random() * 9) + 1;
  state.captchaB = Math.floor(Math.random() * 9) + 1;
  $("captchaText").textContent = `人机验证：${state.captchaA} + ${state.captchaB} = ?`;
}
setCaptcha();
$("refreshCaptcha").onclick = setCaptcha;

function setStep(step) {
  state.step = Math.max(0, Math.min(4, step));
  document.querySelectorAll(".flow-step").forEach(p => p.classList.toggle("active-step", Number(p.dataset.stepPanel) === state.step));
  document.querySelectorAll(".step-dot").forEach(dot => {
    const s = Number(dot.dataset.step);
    dot.classList.toggle("active", s === state.step);
    dot.classList.toggle("done", s < state.step);
  });
  document.querySelectorAll(".progress-line").forEach((line, i) => line.classList.toggle("done", i < state.step));
  window.scrollTo({top: 0, behavior: "smooth"});
}
document.querySelectorAll(".step-dot").forEach(dot => dot.onclick = () => setStep(Number(dot.dataset.step)));
document.querySelectorAll("[data-prev]").forEach(btn => btn.onclick = () => setStep(state.step - 1));

$("resetFlowBtn").onclick = () => {
  state.step = 0;
  state.parsed = null;
  $("resumeInput").value = "";
  $("parseResult").textContent = "尚未生成。";
  $("refineResult").textContent = "等待精炼...";
  $("materialPreview").textContent = "等待材料...";
  $("parseVisual").innerHTML = '<div class="empty-state">点击下方按钮后，这里会逐步弹出关键词、经历卡片和缺失项。</div>';
  $("refineVisual").innerHTML = '<div class="empty-state">点击“精炼并写入”后，将生成求职记忆卡片。</div>';
  setStep(0);
};

$("registerBtn").onclick = () => {
  const username = $("username").value.trim();
  const nickname = $("nickname").value.trim();
  const captcha = $("captchaInput").value.trim();
  if (!username || !nickname) {
    $("authMessage").textContent = "请至少填写用户名和昵称。";
    return;
  }
  if (Number(captcha) !== state.captchaA + state.captchaB) {
    $("authMessage").textContent = "验证码不正确，请重试。";
    return;
  }
  state.currentUser = {username, nickname, email: $("email").value.trim()};
  $("authMessage").textContent = `欢迎 ${nickname}，注册完成。`;
  setStep(1);
};

document.querySelectorAll(".choice-card").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".choice-card").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    $("resumeInput").placeholder = mode === "hasResume"
      ? "粘贴你的简历、项目经历、实习经历、竞赛经历..."
      : "请用自然语言回答：你的专业、年级、目标岗位、课程/项目/竞赛/实习、会哪些工具技能？";
  };
});

$("sampleBtn").onclick = () => {
  $("resumeInput").value = "我是长春理工大学本科生，材料相关专业，大三。做过SKY蓝天AI长期记忆项目，负责官网展示、系统原型、人格画像问卷、记忆精炼模块设计和项目路演包装。项目使用HTML/CSS/JavaScript、Python、Streamlit，并尝试接入DeepSeek API。参加过挑战杯和项目申报，擅长PPT、项目书、科研写作、数据分析，也有延吉市环保局实习经历。目标岗位包括AI产品助理、数据分析实习生、科研助理、AIGC运营实习生。";
};

$("resumeFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) {
    $("fileStatus").textContent = "尚未选择文件";
    return;
  }
  $("fileStatus").textContent = `正在读取：${file.name}（${Math.round(file.size / 1024)} KB）...`;
  try {
    const result = await uploadResumeFile(file);
    $("resumeInput").value = result.text || "";
    $("fileStatus").textContent = `已读取文件：${result.filename || file.name}。可以继续点击“下一步：材料解析”。`;
  } catch (err) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".txt") || lower.endsWith(".md")) {
      const text = await file.text();
      $("resumeInput").value = text;
      $("fileStatus").textContent = `后端未连接，已在浏览器中读取文本文件：${file.name}`;
    } else {
      $("fileStatus").textContent = `文件已选择，但后端读取失败。请确认从 http://127.0.0.1:5000 打开网页，或复制正文粘贴。`;
    }
  }
});

$("toParseBtn").onclick = () => {
  const text = $("resumeInput").value.trim();
  if (!text) {
    alert("请先粘贴或填写经历材料。");
    return;
  }
  $("materialPreview").textContent = text;
  renderParseVisualSkeleton();
  setStep(2);
};

function unique(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function cleanAIText(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function parseMaterial(text) {
  const skills = ["Python","Streamlit","Flask","HTML","CSS","JavaScript","DeepSeek","RAG","Agent","PPT","项目书","科研写作","数据分析","COMSOL","Origin","GitHub","用户调研","市场调研","财务分析","风险评估"];
  const found = skills.filter(k => text.toLowerCase().includes(k.toLowerCase()));
  const exp = [];
  if (text.includes("项目") || text.includes("SKY")) exp.push({type:"项目经历", title:"AI求职/长期记忆相关项目", summary:"围绕AI应用、长期记忆、用户画像和项目展示完成原型设计与材料包装。"});
  if (text.includes("实习")) exp.push({type:"实习经历", title:"实习经历", summary:"具备真实组织环境下的实践经历，可用于体现责任心、沟通和执行能力。"});
  if (text.includes("比赛") || text.includes("挑战杯") || text.includes("竞赛")) exp.push({type:"竞赛经历", title:"创新创业/学科竞赛经历", summary:"具备项目申报、路演表达、成果展示和团队协作经验。"});
  if (!exp.length) exp.push({type:"原始经历", title:"用户导入材料", summary:text.slice(0,120)});
  const targets = [];
  ["AI产品助理","数据分析实习生","科研助理","AIGC运营实习生","材料研发助理"].forEach(t => {
    if (text.includes(t.slice(0,2)) || text.includes(t)) targets.push(t);
  });
  return {
    education: text.includes("大学") ? "本科在读 / 高校学生" : "待补充",
    target_jobs: targets.length ? targets : ["AI产品助理","数据分析实习生","科研助理"],
    skills: unique(found),
    experiences: exp,
    missing_fields: ["量化成果","目标岗位优先级","每段经历中的本人职责"],
    agent_source: "local_rule_engine"
  };
}
function refine(parsed) {
  const tags = unique([...(parsed.skills || []), "跨学科能力", "项目表达", "快速学习"]);
  return {
    memory_type:"career_asset",
    title:"个人求职经历资产",
    refined_summary:`已识别 ${parsed.experiences.length} 类经历，可面向 ${parsed.target_jobs.join("、")} 等岗位复用。核心优势包括：${tags.slice(0,6).join("、")}。`,
    ability_tags:tags.slice(0,10),
    job_relevance:parsed.target_jobs,
    importance_score:86,
    resume_value:"high",
    suggested_layer:"long_term",
    agent_source:"local_rule_engine",
    saved_at:new Date().toLocaleString()
  };
}
function renderJSON(obj) {
  return JSON.stringify(obj, null, 2);
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function setLoading(id, isLoading) {
  const el = $(id);
  if (el) el.classList.toggle("hidden", !isLoading);
}
function renderParseVisualSkeleton() {
  $("parseVisual").innerHTML = `<div class="visual-block"><h4>解析完成后将展示</h4><div class="keyword-cloud"><span class="keyword-chip">技能标签</span><span class="keyword-chip">经历类型</span><span class="keyword-chip">岗位方向</span><span class="keyword-chip">缺失字段</span></div></div>`;
}
async function renderParseVisual(parsed) {
  const box = $("parseVisual");
  box.innerHTML = "";
  const blocks = [
    {title:"识别到的目标岗位", chips:parsed.target_jobs || []},
    {title:"提取到的技能关键词", chips:parsed.skills || []},
    {title:"仍需补充的信息", chips:parsed.missing_fields || []}
  ];
  for (const b of blocks) {
    const div = document.createElement("div");
    div.className = "visual-block";
    div.innerHTML = `<h4>${b.title}</h4><div class="keyword-cloud"></div>`;
    box.appendChild(div);
    const cloud = div.querySelector(".keyword-cloud");
    const chips = b.chips && b.chips.length ? b.chips : ["待补充"];
    for (const c of chips.slice(0,12)) {
      await sleep(90);
      const span = document.createElement("span");
      span.className = "keyword-chip";
      span.textContent = c;
      cloud.appendChild(span);
    }
  }
  const exp = document.createElement("div");
  exp.className = "visual-block";
  exp.innerHTML = `<h4>经历卡片</h4><div class="experience-list"></div>`;
  box.appendChild(exp);
  const list = exp.querySelector(".experience-list");
  for (const e of (parsed.experiences || []).slice(0,5)) {
    await sleep(120);
    const card = document.createElement("div");
    card.className = "experience-card";
    card.innerHTML = `<b>${e.type || "经历"}｜${e.title || "未命名经历"}</b><p>${e.summary || ""}</p>`;
    list.appendChild(card);
  }
}
async function renderRefineVisual(memory) {
  const box = $("refineVisual");
  box.innerHTML = "";
  const div = document.createElement("div");
  div.className = "visual-block";
  div.innerHTML = `<h4>${memory.title || "求职记忆资产"}</h4><p class="memory-summary">${memory.refined_summary || ""}</p><div class="memory-meta">重要度 ${memory.importance_score || "--"}｜${memory.suggested_layer || "long_term"}</div><div class="keyword-cloud"></div>`;
  box.appendChild(div);
  const cloud = div.querySelector(".keyword-cloud");
  for (const t of (memory.ability_tags || []).slice(0,12)) {
    await sleep(80);
    const span = document.createElement("span");
    span.className = "keyword-chip";
    span.textContent = t;
    cloud.appendChild(span);
  }
}

$("parseBtn").onclick = async () => {
  const text = $("resumeInput").value.trim();
  if (!text) {
    $("parseResult").textContent = "请先粘贴简历或经历材料。";
    return;
  }
  setLoading("parseLoading", true);
  $("parseVisual").innerHTML = "";
  $("parseResult").textContent = "正在解析...";
  try {
    state.parsed = await parseWithDeepSeek(text);
  } catch (e) {
    state.parsed = parseMaterial(text);
    state.parsed.agent_source = "local_rule_engine_after_api_error";
  }
  setLoading("parseLoading", false);
  $("parseResult").textContent = renderJSON(state.parsed);
  await renderParseVisual(state.parsed);
};
$("toRefineBtn").onclick = () => {
  if (!state.parsed) {
    alert("请先点击“运行解析”。");
    return;
  }
  setStep(3);
};
$("refineBtn").onclick = async () => {
  if (!state.parsed) {
    $("refineResult").textContent = "请先运行材料解析智能体。";
    return;
  }
  setLoading("refineLoading", true);
  $("refineVisual").innerHTML = "";
  $("refineResult").textContent = "正在精炼...";
  let m;
  try {
    m = await refineWithDeepSeek(state.parsed);
  } catch (e) {
    m = refine(state.parsed);
    m.agent_source = "local_rule_engine_after_api_error";
  }
  if (!m.saved_at) m.saved_at = new Date().toLocaleString();
  state.memories.push(m);
  saveMemories();
  setLoading("refineLoading", false);
  $("refineResult").textContent = renderJSON(m);
  await renderRefineVisual(m);
};
$("finishFlowBtn").onclick = () => {
  if (!state.memories.length) {
    alert("请先精炼并写入至少一条求职记忆。");
    return;
  }
  setStep(4);
};

function formatMemoryTag(tag) {
  if (!tag) return "";
  return String(tag).trim().replace(/\s+/g, " ");
}

function renderMemories() {
  const box = $("memoryList");
  if (!state.memories.length) {
    box.innerHTML = '<div class="empty-card">暂无记忆，请先完成材料导入。</div>';
    return;
  }

  box.innerHTML = state.memories.map((m, i) => {
    const tags = (m.ability_tags || [])
      .map(formatMemoryTag)
      .filter(Boolean)
      .slice(0, 10);

    return `<div class="memory-card">
      <div class="memory-meta">#${i + 1}｜${m.suggested_layer || "memory"}｜重要度 ${m.importance_score || "--"}</div>
      <h3>${m.title || "求职记忆"}</h3>
      <div class="memory-summary">${m.refined_summary || ""}</div>
      <div class="memory-tag-wrap">
        ${tags.map(t => `<span class="memory-tag">${t}</span>`).join("")}
      </div>
    </div>`;
  }).join("");
}
$("clearMemoryBtn").onclick = () => {
  if (confirm("确定清空本地使用记忆吗？")) {
    state.memories = [];
    saveMemories();
  }
};
$("exportMemoryBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(state.memories, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sky_zhiyi_memory.json";
  a.click();
};

function tokenizeQuery(q) {
  const raw = q || "";
  const base = raw.toLowerCase().replace(/[，,\/|;；、]/g, " ").split(/\s+/).filter(Boolean);
  let extra = [];
  if (raw.includes("AI产品")) extra.push("ai","产品","产品助理");
  if (raw.includes("数据")) extra.push("数据","分析","数据分析");
  if (raw.includes("材料")) extra.push("材料","研发");
  if (raw.includes("科研")) extra.push("科研","助理");
  if (raw.includes("运营")) extra.push("运营","用户");
  return unique(base.concat(extra));
}
function scoreJob(job, kw, city) {
  let score = 22;
  const text = Object.values(job).join(" ").toLowerCase();
  const jobName = (job.job || "").toLowerCase();
  const industry = (job.industry || "").toLowerCase();
  const company = (job.company || "").toLowerCase();
  const tokens = tokenizeQuery(kw);
  let reasons = [];

  tokens.forEach(t => {
    if (!t) return;
    if (jobName.includes(t)) { score += 26; reasons.push(`岗位相关：${t}`); }
    else if (industry.includes(t)) { score += 14; reasons.push(`行业相关：${t}`); }
    else if (company.includes(t)) { score += 10; reasons.push(`单位相关：${t}`); }
    else if (text.includes(t)) { score += 7; reasons.push(`信息相关：${t}`); }
  });

  if (jobName.includes("产品") || industry.includes("产品")) score += 8;
  if (jobName.includes("数据") || jobName.includes("分析")) score += 8;
  if (jobName.includes("材料") || jobName.includes("研发")) score += 8;
  if (jobName.includes("实习") || String(job.type || "").includes("实习")) score += 4;

  if (city) {
    if (String(job.city || "").includes(city)) { score += 18; reasons.push(`城市匹配：${city}`); }
    else score -= 30;
  }
  if (String(job.exam || "").includes("否")) { score += 4; reasons.push("免笔试"); }
  if (!tokens.length) reasons.push("通用推荐");
  if (!reasons.length) reasons.push("可作为备选");
  return {score: Math.min(Math.max(score, 0), 98), reasons: unique(reasons).slice(0,3).join(" / ")};
}
function highlightCity(cityText, selectedCity) {
  if (!cityText) return "地点待补充";
  if (!selectedCity) return cityText;
  const safe = selectedCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cityText.replace(new RegExp(safe, "g"), `<mark class="city-mark">${selectedCity}</mark>`);
}

function summarizeCompany(job) {
  const industry = (job.industry || "").trim();
  const company = (job.company || "").trim();
  if (industry) return industry;
  if (company.includes("医院")) return "医疗健康服务机构";
  if (company.includes("银行")) return "金融服务机构";
  if (company.includes("科技") || company.includes("智能") || company.includes("数据")) return "科技与数字化服务企业";
  if (company.includes("材料") || company.includes("新能源")) return "先进制造与新材料相关企业";
  return "招聘单位行业信息待补充";
}

function compactJobText(text) {
  if (!text) return "岗位信息待补充";
  return String(text).replace(/\s+/g, " ").trim();
}

function renderJobs(list) {
  const box = $("jobCardList");
  if (!box) return;
  if (!list || !list.length) {
    box.innerHTML = '<div class="empty-card">没有找到匹配度 50 以上的岗位。可以换个关键词，或清空城市筛选后再试。</div>';
    const info = $("jobResultInfo");
    if (info) info.textContent = "未找到高匹配岗位。";
    return;
  }

  const selectedCity = $("cityKeyword") ? $("cityKeyword").value.trim() : "";

  box.innerHTML = list.map((j, idx) => {
    const score = Number(j.score || 0);
    const level = score >= 80 ? "高度匹配" : score >= 65 ? "较匹配" : "可尝试";
    const companyType = summarizeCompany(j);
    const jobText = compactJobText(j.job);
    const cityText = highlightCity(j.city || "地点待补充", selectedCity);
    const examText = j.exam ? (String(j.exam).includes("否") ? "免笔试" : "含笔试") : "笔试情况待补充";
    const typeText = j.type || "招聘类型待补充";
    const deadlineText = j.deadline || "截止日期待补充";
    const link = j.link ? `<a class="btn btn-secondary small-btn job-apply-btn" href="${j.link}" target="_blank">投递链接</a>` : "";
    return `<article class="job-card job-card-compact">
      <div class="job-card-top">
        <div class="job-main-info">
          <div class="job-company job-company-large">${j.company || "招聘单位"}</div>
          <div class="company-desc">${companyType}</div>
        </div>
        <div class="job-score">
          <b>${score}</b>
          <span>${level}</span>
        </div>
      </div>

      <details class="job-details">
        <summary>查看岗位与地点信息</summary>
        <div class="detail-block">
          <b>招聘岗位</b>
          <p class="small-detail">${jobText}</p>
        </div>
        <div class="detail-block">
          <b>工作地点</b>
          <p class="small-detail">${cityText}</p>
        </div>
        <div class="detail-mini-grid">
          <span>${typeText}</span>
          <span>${examText}</span>
          <span>${deadlineText}</span>
        </div>
      </details>

      <div class="job-card-bottom">
        <span class="job-rank">推荐序号 ${idx + 1}</span>
        ${link}
      </div>
    </article>`;
  }).join("");

  const info = $("jobResultInfo");
  const start = (state.jobPage - 1) * state.pageSize + 1;
  const end = Math.min(state.jobPage * state.pageSize, state.jobTotal || list.length);
  if (info) info.textContent = `${state.jobSearchMode === "backend" ? "本地岗位库" : "本地检索"}：共 ${state.jobTotal || list.length} 条高匹配岗位，当前展示 ${start}-${end}`;
}

$("matchJobsBtn").onclick = async () => {
  const kw = $("jobKeyword").value.trim();
  const city = $("cityKeyword").value.trim();
  state.lastJobKeyword = kw;
  state.lastJobCity = city;
  state.jobPage = 1;
  const info = $("jobResultInfo");
  if (info) info.textContent = "正在本地检索岗位，请稍候...";
  try {
    const result = await searchJobs(kw, city, 1);
    renderJobs(result.rows || []);
  } catch (e) {
    if (info) info.textContent = "岗位检索失败：请确认后端已启动，并从 http://127.0.0.1:5000 打开网页。";
    console.error(e);
  }
};
$("prevJobPage").onclick = async () => {
  if (state.jobPage > 1) {
    const result = await searchJobs(state.lastJobKeyword || $("jobKeyword").value.trim(), state.lastJobCity || $("cityKeyword").value.trim(), state.jobPage - 1);
    renderJobs(result.rows || []);
  }
};
$("nextJobPage").onclick = async () => {
  if (state.jobPage * state.pageSize < (state.jobTotal || 0)) {
    const result = await searchJobs(state.lastJobKeyword || $("jobKeyword").value.trim(), state.lastJobCity || $("cityKeyword").value.trim(), state.jobPage + 1);
    renderJobs(result.rows || []);
  }
};

fetch("data/interview_questions.json").then(r => r.json()).then(d => state.questions = d).catch(() => state.questions = []);
const infoInit = $("jobResultInfo");
if (infoInit) infoInit.textContent = "输入目标岗位和城市，系统将推荐匹配度 50 以上的岗位。";
renderJobs([]);

function localEvaluateAnswer(question, answer, target) {
  const len = answer.trim().length;
  let level = len > 180 ? "较完整" : len > 80 ? "基本可用" : "偏简略";
  let suggestions = [];
  if (!/[0-9一二三四五六七八九十]/.test(answer)) suggestions.push("可以补充量化结果，例如完成数量、提升比例、周期或排名。");
  if (!answer.includes("我") && !answer.includes("负责") && !answer.includes("参与")) suggestions.push("建议明确你本人承担的职责，而不是只描述项目本身。");
  if (!answer.includes("结果") && !answer.includes("最终") && !answer.includes("提升")) suggestions.push("建议最后补充结果和复盘。");
  if (!suggestions.length) suggestions.push("回答结构较完整，后续可以再压缩语言，让表达更自然。");
  return `评价：${level}\n针对岗位：${target}\n建议：\n- ${suggestions.join("\n- ")}`;
}
function renderQuestionPractice(questions, target) {
  const list = $("questionList");
  if (!questions.length) {
    list.innerHTML = "暂无问题。";
    return;
  }
  list.innerHTML = questions.map((q, i) => {
    const question = cleanAIText(q.question || "面试问题");
    const why = cleanAIText(q.why || q.intent || "");
    const hint = cleanAIText(q.answer_hint || q.hint || "");
    return `<div class="question-item" data-qidx="${i}">
      <b>${i+1}. ${question}</b>
      ${why ? `<p>考查点：${why}</p>` : ""}
      ${hint ? `<p>回答建议：${hint}</p>` : ""}
      <textarea class="answer-input" id="answer_${i}" placeholder="在这里输入你的回答，系统会给出改进建议..."></textarea>
      <div class="answer-actions">
        <button class="btn btn-secondary small-btn" onclick="evaluateAnswer(${i})">评价我的回答</button>
        <button class="btn btn-secondary small-btn" onclick="saveAnswerAsMemory(${i})">保存为面试记忆</button>
      </div>
      <div class="answer-feedback hidden" id="feedback_${i}"></div>
    </div>`;
  }).join("");
  state.currentQuestions = questions;
  state.currentInterviewTarget = target;
}
window.evaluateAnswer = async function(i) {
  const q = state.currentQuestions?.[i] || {};
  const ans = $(`answer_${i}`).value.trim();
  const fb = $(`feedback_${i}`);
  if (!ans) {
    fb.textContent = "请先输入你的回答。";
    fb.classList.remove("hidden");
    return;
  }
  fb.textContent = "正在分析你的回答...";
  fb.classList.remove("hidden");
  try {
    const result = await evaluateAnswerWithDeepSeek(cleanAIText(q.question || ""), ans, state.currentInterviewTarget || "目标岗位");
    if (result) {
      const strengths = (result.strengths || []).map(x => `- ${cleanAIText(x)}`).join("\n");
      const suggestions = (result.suggestions || []).map(x => `- ${cleanAIText(x)}`).join("\n");
      const overall = cleanAIText(result.overall || "");
      const polished = cleanAIText(result.polished_answer || "");
      fb.textContent = `总体评价：${overall}\n\n优点：\n${strengths || "- 暂无"}\n\n改进建议：\n${suggestions || "- 暂无"}\n\n优化示范：\n${polished || ans}`;
      return;
    }
  } catch (e) {}
  fb.textContent = cleanAIText(localEvaluateAnswer(cleanAIText(q.question || ""), ans, state.currentInterviewTarget || "目标岗位"));
};
window.saveAnswerAsMemory = function(i) {
  const q = state.currentQuestions?.[i] || {};
  const ans = $(`answer_${i}`).value.trim();
  if (!ans) {
    alert("请先输入回答。");
    return;
  }
  state.memories.push({
    memory_type:"interview_answer",
    title:"面试回答练习",
    refined_summary:`问题：${cleanAIText(q.question)}\n回答：${ans}`,
    ability_tags:["面试回答","表达训练","复盘"],
    job_relevance:[state.currentInterviewTarget || "目标岗位"],
    importance_score:72,
    resume_value:"medium",
    suggested_layer:"transition_memory",
    agent_source:"user_answer",
    saved_at:new Date().toLocaleString()
  });
  saveMemories();
  alert("已保存到求职记忆库。");
};

$("generateInterviewBtn").onclick = async () => {
  const target = $("interviewJob").value.trim() || "目标岗位";
  $("selfIntroBox").textContent = "正在生成训练方案...";
  $("questionList").innerHTML = "<div class='loading-area'><div class='loader'></div><p>面试教练官正在根据记忆库生成追问题...</p></div>";
  try {
    const plan = await interviewWithDeepSeek(target, state.memories);
    if (plan) {
      $("selfIntroBox").textContent = cleanAIText(plan.self_intro || "已生成。");
      renderQuestionPractice(plan.questions || [], target);
      return;
    }
  } catch (e) {}
  const latest = state.memories[state.memories.length - 1];
  const tags = latest ? (latest.ability_tags || []).slice(0,5).join("、") : "学习能力、项目执行、沟通表达";
  $("selfIntroBox").textContent = `您好，我是${state.currentUser?.nickname || "一名大学生"}。我目前希望投递${target}方向。我的优势是${tags}。在过往项目和实践中，我参与过AI应用原型、项目材料整理和成果展示等工作，能够把复杂问题拆解成可落地的方案。希望未来在岗位中继续提升专业能力，为团队创造实际价值。`;
  const qs = [...state.questions];
  qs.push({question:`请介绍一下你最能体现${target}能力的项目。`, intent:"考查岗位相关项目经验。", hint:"说明项目背景、本人职责、使用工具、结果和反思。"});
  renderQuestionPractice(qs.slice(0,5), target);
};

$("saveFeedbackBtn").onclick = () => {
  const fb = $("feedbackInput").value.trim();
  if (!fb) {
    alert("请先填写面试反馈。");
    return;
  }
  state.memories.push({
    memory_type:"interview_feedback",
    title:"面试反馈记忆",
    refined_summary:fb,
    ability_tags:["面试反馈","表达优化","复盘"],
    job_relevance:[$("interviewJob").value.trim() || "目标岗位"],
    importance_score:76,
    resume_value:"medium",
    suggested_layer:"transition_memory",
    agent_source:"user_feedback",
    saved_at:new Date().toLocaleString()
  });
  saveMemories();
  $("feedbackInput").value = "";
  alert("已保存到求职记忆库。");
};

renderMemories();
