"""Recreate the application's simple typographic Windows icon with Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((10, 10, 246, 246), radius=46, fill="#396eb0")
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 162)
draw.text((128, 122), "思", font=font, fill="white", anchor="mm")
folder = root / "resources"
folder.mkdir(exist_ok=True)
image.save(folder / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
