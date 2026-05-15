from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT_PDF = ROOT / "output" / "pdf" / "cognitive-siege-portfolio-onepager-polished.pdf"
SHOT = ROOT / ".playwright-cli" / "page-2026-05-14T03-49-54-377Z.png"
TMP_DIR = ROOT / "tmp" / "pdfs"
TMP_SHOT = TMP_DIR / "portfolio-gameplay-shot.jpg"

PAGE_W, PAGE_H = landscape(A4)

BG = colors.HexColor("#080713")
PANEL = colors.HexColor("#141128")
PANEL_2 = colors.HexColor("#17132f")
LINE = colors.HexColor("#5b4c92")
CYAN = colors.HexColor("#63e6ff")
GREEN = colors.HexColor("#35d49e")
YELLOW = colors.HexColor("#ffe86b")
PINK = colors.HexColor("#ff6fb5")
PURPLE = colors.HexColor("#aa8cff")
WHITE = colors.HexColor("#f4f0ff")
MUTED = colors.HexColor("#c4b8e8")
DIM = colors.HexColor("#8f82be")


def register_fonts() -> tuple[str, str, str]:
    regular = Path("C:/Windows/Fonts/Deng.ttf")
    bold = Path("C:/Windows/Fonts/simhei.ttf")
    mono = Path("C:/Windows/Fonts/Dengb.ttf")
    if regular.exists():
        pdfmetrics.registerFont(TTFont("CS-Regular", str(regular)))
    if bold.exists():
        pdfmetrics.registerFont(TTFont("CS-Bold", str(bold)))
    if mono.exists():
        pdfmetrics.registerFont(TTFont("CS-Mono", str(mono)))
    return (
        "CS-Regular" if regular.exists() else "Helvetica",
        "CS-Bold" if bold.exists() else "Helvetica-Bold",
        "CS-Mono" if mono.exists() else "Courier",
    )


FONT, BOLD, MONO = register_fonts()


def sw(text: str, font: str, size: float) -> float:
    return pdfmetrics.stringWidth(text, font, size)


def draw_text(c: canvas.Canvas, text: str, x: float, y: float, size: float, color=WHITE, font=FONT):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, text)


def wrap_text(text: str, font: str, size: float, max_width: float) -> list[str]:
    lines: list[str] = []
    line = ""
    for ch in text:
        candidate = line + ch
        if ch == "\n":
            lines.append(line)
            line = ""
        elif sw(candidate, font, size) <= max_width:
            line = candidate
        else:
            if line:
                lines.append(line)
            line = ch
    if line:
        lines.append(line)
    return lines


def draw_wrapped(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    size: float,
    leading: float,
    color=MUTED,
    font=FONT,
    max_lines: int | None = None,
) -> float:
    lines = wrap_text(text, font, size, width)
    if max_lines is not None:
        lines = lines[:max_lines]
    for line in lines:
        draw_text(c, line, x, y, size, color, font)
        y -= leading
    return y


def round_panel(c: canvas.Canvas, x: float, y: float, w: float, h: float, stroke=LINE, fill=PANEL, radius=10):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, radius, stroke=1, fill=1)


def section_title(c: canvas.Canvas, title: str, x: float, y: float, color=CYAN):
    draw_text(c, title, x, y, 14, color, BOLD)


def stat_card(c: canvas.Canvas, x: float, y: float, w: float, h: float, value: str, label: str, color):
    round_panel(c, x, y, w, h, stroke=color, fill=colors.Color(0.08, 0.07, 0.15, alpha=1), radius=8)
    draw_text(c, value, x + 13, y + 28, 15, color, BOLD)
    draw_text(c, label, x + 13, y + 10, 8.5, DIM, FONT)


def prepare_screenshot() -> Path | None:
    if not SHOT.exists():
        return None
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    im = Image.open(SHOT).convert("RGB")
    # Keep the full battlefield and bottom tool strip; crop only browser margins if present.
    im = im.crop((0, 0, im.width, im.height))
    im.save(TMP_SHOT, quality=88)
    return TMP_SHOT


def draw_mechanic_row(c: canvas.Canvas, y: float, name: str, system: str, decision: str, color) -> float:
    draw_text(c, name, 475, y, 9.2, color, BOLD)
    draw_wrapped(c, system, 530, y, 160, 7.4, 9, MUTED, FONT, max_lines=2)
    draw_wrapped(c, decision, 680, y, 114, 7.4, 9, WHITE, FONT, max_lines=2)
    c.setStrokeColor(colors.HexColor("#2d264d"))
    c.setLineWidth(0.5)
    c.line(475, y - 8, 800, y - 8)
    return y - 27


def build_pdf():
    OUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    shot = prepare_screenshot()
    c = canvas.Canvas(str(OUT_PDF), pagesize=(PAGE_W, PAGE_H))
    c.setTitle("认知围城 - 游戏策划作品集一页纸")
    c.setAuthor("郑毅")

    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    # Quiet structure lines instead of decorative blobs.
    c.setStrokeColor(colors.HexColor("#15122a"))
    c.setLineWidth(0.6)
    for x in range(34, int(PAGE_W), 48):
        c.line(x, 28, x + 110, PAGE_H - 28)

    # Header.
    draw_text(c, "认知围城", 34, 548, 30, PURPLE, BOLD)
    draw_text(c, "Cognitive Siege", 170, 551, 13, CYAN, MONO)
    draw_text(c, "AI 复盘驱动的自适应塔防原型", 34, 523, 13, WHITE, BOLD)
    draw_text(c, "心魔会复盘、谈判，并真实改写下一波路线、阵型、技能和地图压力。", 34, 505, 9.8, MUTED, FONT)
    draw_text(c, "郑毅 / 游戏策划作品集", 661, 548, 11, YELLOW, BOLD)
    draw_text(c, "系统设计 · 关卡机制 · 数值调优 · AI Agent 落地", 610, 526, 9, MUTED, FONT)

    # Stat cards.
    stats = [
        ("6章 / 60波", "完整战役结构", GREEN),
        ("5套强机制", "每章地图差异", CYAN),
        ("17张CSV", "可维护配置管线", YELLOW),
        ("LLM + fallback", "可在线 / 可演示", PINK),
        ("Web可玩", "浏览器直接体验", PURPLE),
    ]
    card_w, gap = 145, 9
    for idx, (value, label, color) in enumerate(stats):
        stat_card(c, 34 + idx * (card_w + gap), 456, card_w, 45, value, label, color)

    # Left: real screenshot.
    round_panel(c, 34, 205, 420, 230, stroke=CYAN, fill=PANEL, radius=10)
    section_title(c, "实机战斗画面", 54, 414, CYAN)
    draw_text(c, "路线亮线 / 塔位 / 地图物 / 布防 UI 都来自当前版本", 166, 415, 8.4, DIM, FONT)
    if shot is not None:
        c.drawImage(str(shot), 54, 229, width=380, height=171, preserveAspectRatio=True, anchor="c", mask="auto")
        c.setStrokeColor(colors.HexColor("#342b58"))
        c.rect(54, 229, 380, 171, stroke=1, fill=0)

    # Left bottom: design thesis.
    round_panel(c, 34, 97, 420, 92, stroke=YELLOW, fill=PANEL_2, radius=10)
    section_title(c, "核心设计命题", 54, 164, YELLOW)
    draw_wrapped(
        c,
        "不是让 LLM 只生成气氛文本，而是把复盘结果转成可验证的下一波改表：路线权重、阵型、技能、心魔种类和侵略度都会进入战斗逻辑。",
        54,
        144,
        380,
        9.4,
        13,
        WHITE,
        FONT,
        max_lines=4,
    )

    round_panel(c, 34, 34, 420, 48, stroke=GREEN, fill=PANEL, radius=9)
    draw_text(c, "投递重点", 54, 62, 12, GREEN, BOLD)
    draw_text(c, "AI玩法落地 + 关卡节奏 + 地图机制 + 数值调优 + 可维护配置生产线", 122, 62, 9.1, WHITE, FONT)
    draw_text(c, "线上游玩：https://which336.github.io/Cognitive_Siege/", 122, 45, 8.3, CYAN, MONO)

    # Right top: ownership.
    round_panel(c, 470, 333, 337, 111, stroke=PURPLE, fill=PANEL, radius=10)
    section_title(c, "我负责的策划工作", 490, 417, CYAN)
    ownership = [
        ("系统", "塔 / 心魔 / Boss / 塑形 / 索敌 / 教学"),
        ("关卡", "1章教学 + 5章机制差异；10波一关"),
        ("数值", "CSV 表结构、校验报告、平衡日志"),
        ("AI", "复盘约束、策略落地、安全阀与 fallback"),
    ]
    y = 397
    for name, desc in ownership:
        draw_text(c, name, 492, y, 9.5, YELLOW, BOLD)
        draw_text(c, desc, 538, y, 8.4, WHITE, FONT)
        y -= 20

    # Right middle: mechanic matrix.
    round_panel(c, 470, 143, 337, 181, stroke=CYAN, fill=PANEL, radius=10)
    section_title(c, "关卡机制矩阵：玩家决策变化", 490, 297, CYAN)
    draw_text(c, "机制", 475, 279, 7.5, DIM, FONT)
    draw_text(c, "系统效果", 530, 279, 7.5, DIM, FONT)
    draw_text(c, "玩家决策", 680, 279, 7.5, DIM, FONT)
    y = 260
    y = draw_mechanic_row(c, y, "呼吸阀", "吸气加速 / 呼气易伤", "按相位切 AOE 与单体", GREEN)
    y = draw_mechanic_row(c, y, "镜门", "延迟生成回声体", "拆门或预留副线火力", CYAN)
    y = draw_mechanic_row(c, y, "枯井", "压塔位 / 压残堆", "先拆经济或先补防", YELLOW)
    y = draw_mechanic_row(c, y, "裂隙", "边路短时加速", "边界桩压制 / 拆节点", PINK)
    draw_mechanic_row(c, y, "审判碑", "精英护盾 + 减伤", "拆碑或拦在范围外", PURPLE)

    # Right bottom: tuning evidence.
    round_panel(c, 470, 34, 337, 94, stroke=YELLOW, fill=PANEL_2, radius=10)
    section_title(c, "调优证据链", 490, 104, YELLOW)
    evidence = [
        ("Run 004", "第4波早死，判定教学过硬", CYAN),
        ("Change 004", "重做前4波教学 / 塔提示", GREEN),
        ("Change 006", "6章独立地图 + 17张CSV", PURPLE),
        ("Change 007", "枯井压制塔位，击破释放", PINK),
    ]
    positions = [(492, 81), (650, 81), (492, 55), (650, 55)]
    for idx, ((tag, text, color), (x, y)) in enumerate(zip(evidence, positions)):
        c.setFillColor(color)
        c.circle(x, y + 3, 6, stroke=0, fill=1)
        draw_text(c, str(idx + 1), x - 2, y + 1, 5.2, BG, BOLD)
        draw_text(c, tag, x + 13, y + 3, 7.5, WHITE, MONO)
        draw_text(c, text, x + 13, y - 9, 7.2, MUTED, FONT)

    c.showPage()
    c.save()

    portfolio_dirs = list(ROOT.glob("*_*/"))
    for folder in portfolio_dirs:
        if (folder / "README.md").exists() and "作品集" in folder.name:
            target = folder / OUT_PDF.name
            try:
                shutil.copy2(OUT_PDF, target)
            except PermissionError:
                shutil.copy2(OUT_PDF, target.with_name(target.stem + "-updated.pdf"))
            break


if __name__ == "__main__":
    build_pdf()
    print(OUT_PDF)
