import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def create_icon_background(size=1024):
    img = Image.new("RGBA", (size, size), (238, 235, 226, 255)) # #eeebe2
    draw = ImageDraw.Draw(img)
    # Subtle radial gradient / circle glow in the center
    cx, cy = size // 2, size // 2
    for r in range(size // 2, 0, -2):
        factor = r / (size // 2)
        r_col = int(238 - (1 - factor) * 12)
        g_col = int(235 - (1 - factor) * 14)
        b_col = int(226 - (1 - factor) * 14)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(r_col, g_col, b_col, 255))
    return img

def create_icon_foreground(size=1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    
    # Safe zone for adaptive icon foreground is inside the center 66% (diameter ~ 675px)
    # Outer rounded tile / badge
    badge_radius = 260
    # Soft shadow behind badge
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle(
        [cx - badge_radius + 10, cy - badge_radius + 16, cx + badge_radius + 10, cy + badge_radius + 16],
        radius=110,
        fill=(185, 177, 163, 160)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    img.paste(shadow, (0, 0), shadow)

    # Main badge: Serenova Teal gradient (#244d50 to #1b3b3d)
    badge = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(badge)
    bdraw.rounded_rectangle(
        [cx - badge_radius, cy - badge_radius, cx + badge_radius, cy + badge_radius],
        radius=110,
        fill=(36, 77, 80, 255) # #244d50
    )
    img.paste(badge, (0, 0), badge)

    # Draw stylized Serenova 'S' / Neural Flower Symbol in Warm Gold & Light Teal
    # Central ring
    gold = (178, 135, 60, 255) # #b2873c
    gold_light = (212, 175, 105, 255)
    teal_light = (47, 96, 100, 255) # #2f6064
    white_soft = (245, 245, 245, 250)

    # Inner decorative rings and neural nodes
    inner_r = 135
    draw.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], outline=gold_light, width=12)

    # Flowing S-wave / helix across center
    points_s = []
    for step in range(-80, 81):
        t = step / 80.0
        # Parametric S curve
        px = cx + math.sin(t * math.pi) * 85
        py = cy + t * 140
        points_s.append((px, py))

    for i in range(len(points_s) - 1):
        draw.line([points_s[i], points_s[i+1]], fill=white_soft, width=22)

    # 4 Orbiting nodes (representing AI & Wellness core)
    node_dist = 175
    for angle_deg in [45, 135, 225, 315]:
        rad = math.radians(angle_deg)
        nx = cx + int(node_dist * math.cos(rad))
        ny = cy + int(node_dist * math.sin(rad))
        # Draw node circle
        draw.ellipse([nx - 22, ny - 22, nx + 22, ny + 22], fill=gold)
        draw.ellipse([nx - 12, ny - 12, nx + 12, ny + 12], fill=white_soft)
        # Connector to center
        cx_sub = cx + int((node_dist - 40) * math.cos(rad))
        cy_sub = cy + int((node_dist - 40) * math.sin(rad))
        draw.line([(cx_sub, cy_sub), (nx, ny)], fill=gold_light, width=5)

    return img

def create_full_icon(size=1024):
    bg = create_icon_background(size)
    fg = create_icon_foreground(size)
    bg.paste(fg, (0, 0), fg)
    return bg

def create_splash(size=2732, dark=False):
    bg_color = (22, 32, 34, 255) if dark else (238, 235, 226, 255)
    img = Image.new("RGBA", (size, size), bg_color)
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2 - 80

    # Center Logo Icon
    icon = create_full_icon(1024)
    icon_resized = icon.resize((480, 480), Image.Resampling.LANCZOS)
    img.paste(icon_resized, (cx - 240, cy - 240), icon_resized)

    # Try default font or basic layout
    text_color = (238, 235, 226, 255) if dark else (26, 31, 30, 255)
    sub_color = (178, 135, 60, 255) # gold

    # Approximate text drawing using basic bitmap font or shapes if TTF font not found
    try:
        font_large = ImageFont.truetype("arial.ttf", 64)
        font_small = ImageFont.truetype("arial.ttf", 32)
        draw.text((cx, cy + 320), "SERENOVA AI", fill=text_color, font=font_large, anchor="mm")
        draw.text((cx, cy + 380), "Universal Health & AI", fill=sub_color, font=font_small, anchor="mm")
    except Exception:
        pass

    return img

if __name__ == "__main__":
    print("Generating Serenova AI brand assets...")
    bg = create_icon_background(1024)
    bg.save("assets/icon-background.png")
    
    fg = create_icon_foreground(1024)
    fg.save("assets/icon-foreground.png")
    
    only = create_full_icon(1024)
    only.save("assets/icon-only.png")
    only.save("assets/logo.png")
    only.save("assets/icon.png")
    
    splash = create_splash(2732, dark=False)
    splash.save("assets/splash.png")
    
    splash_dark = create_splash(2732, dark=True)
    splash_dark.save("assets/splash-dark.png")
    print("Successfully generated all source assets in assets/!")
