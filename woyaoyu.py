import tkinter as tk
from pathlib import Path
import random
import time
import math

BASE = Path(__file__).resolve().parent
ASSET_DIR = BASE / "resources"

RENDER_SCALE = 0.5
SOURCE_BLOCK = 32
BLOCK = int(SOURCE_BLOCK * RENDER_SCALE)
COLS = 40
ROWS = 36
WIDTH = COLS * BLOCK
HEIGHT = ROWS * BLOCK
RIVER_X0 = 27
RIVER_X1 = 36
RIVER_WIDTH = RIVER_X1 - RIVER_X0 + 1
PLAYER_START = (20, 17)
FISHERMAN_POS = (12, 11)
NPC_BASES = ["NPC_boy", "NPC_girl", "NPC_green_girl"]


FISH_COLORS = [
    ("orange", "#f28c28"),
    ("red", "#d94b4b"),
    ("blue", "#4c83c3"),
    ("purple", "#8d61b8"),
    ("yellow", "#e8c94c"),
]

SQUID_COLORS = [
    ("red", "#d94b4b", 0.20),
    ("blue", "#4c83c3", 0.30),
    ("purple", "#8d61b8", 0.01),
    ("yellow", "#e8c94c", 0.50),
]

NPC_DECISION_PERIOD = 0.75
FISH_STEP_PERIOD = 0.30

# Restricted areas defined by polygon vertices.
# Coordinates are in grid units (not pixels).
RESTRICTED_AREAS = [
    # L-shaped area
    [
        (0, 0),
        (3, 0),
        (3, 30),
        (27, 30),
        (27, 36),
        (0, 36),
    ],

    # Fishing market stand
    [
        (3, 3),
        (18.7, 3),
        (18.7, 14),
        (3, 14),
    ],
        
    # Trees
    [
        (3, 17),
        (4.5, 17),
        (4.5, 20),
        (10.8, 20),
        (10.8, 27),
        (6, 27),
        (6, 30),
        (3, 30),
    ],
    
        # Fish counters
    [
        (3, 0),
        (18.7, 0),
        (18.7, 4),
        (3, 4),
    ],
    
        # Boulder
    [
        (31.8, 7),
        (37, 7),
        (37, 10.5),
        (31.8, 10.5),
    ],
]

class WoyaoYu:
    def __init__(self, root):
        self.root = root
        self.root.title("woyaoyu")
        self.root.resizable(False, False)
        self.root.configure(bg="#20242a")
        self.show_collision_debug = False
        self.canvas = tk.Canvas(root, width=WIDTH, height=HEIGHT, highlightthickness=0, bd=0)
        self.canvas.pack()
        self.assets = {}
        self.load_assets()
        self.canvas.bind("<Button-1>", self.canvas_click)
        self.root.bind("<KeyPress>", self.key_down)
        self.root.focus_force()
        self.last_time = time.monotonic()
        self.npc_timer = 0.0
        self.fish_timer = 0.0
        self.reset_game()
        self.tick()
        
    def draw_collision_debug(self):
        if not self.show_collision_debug:
            return

        for polygon in RESTRICTED_AREAS:
            points = []

            for x, y in polygon:
                points.extend([
                    int(x * BLOCK),
                    int(y * BLOCK)
                ])

            self.canvas.create_polygon(
                points,
                fill="#ff0000",
                stipple="gray50",
                outline="#ff0000",
                width=2
            )  
                
    def is_inside_polygon(self, x, y, polygon):
        inside = False

        j = len(polygon) - 1

        for i in range(len(polygon)):
            xi, yi = polygon[i]
            xj, yj = polygon[j]

            intersects = (
                (yi > y) != (yj > y)
                and x < (xj - xi) * (y - yi) / (yj - yi) + xi
            )

            if intersects:
                inside = not inside

            j = i

        return inside

    def canvas_click(self, event):
        # Click the graphical Reset button drawn on the canvas.
        x1, y1, x2, y2 = [int(v * RENDER_SCALE) for v in (28, 1022, 236, 1104)]
        if x1 <= event.x <= x2 and y1 <= event.y <= y2:
            self.reset_game()

    def load_assets(self):
        # Keep the original high-resolution PNGs untouched and let Tkinter
        # render them at 50% size.
        def load(path):
            image = tk.PhotoImage(file=str(path))
            return image.subsample(2, 2)
            
        self.assets["fish"] = load(ASSET_DIR / "fish.png")
        self.assets["background"] = load(ASSET_DIR / "background_boulder.png")

        # NPC sprites
        for base in NPC_BASES:
            for direction in ("left", "right"):
                name = f"{base}_{direction}.png"
                self.assets[name] = load(ASSET_DIR / name)

        # Grass player sprites
        for name in (
            "Player_stand_front",
            "Player_stand_back",
            "Player_stand_left",
            "Player_stand_right",
            "Player_walk_left",
            "Player_walk_right",
        ):
            self.assets[name] = load(ASSET_DIR / f"{name}.png")

        # Water player sprites
        for name in (
            "Player_water_left",
            "Player_water_right",
            "Player_water_front",
            "Player_water_back",
        ):
            self.assets[name] = load(ASSET_DIR / f"{name}.png")

        # Fish sprites
        for name in ("orange", "red", "yellow", "blue", "purple"):
            self.assets[f"fish_{name}"] = load(
                ASSET_DIR / f"fish_{name}.png"
            )

        # Squid sprites
        for name in ("red", "blue", "purple", "yellow"):
            self.assets[f"squid_{name}"] = load(
                ASSET_DIR / f"Squid_{name}.png"
            )
            
    def reset_game(self):
        self.player = [PLAYER_START[0], PLAYER_START[1]]
        self.player_facing = "down"
        self.player_walk_frame = False

        self.fish = None
        self.caught_fish = None
        self.carried_fish = None

        self.score = 0
        self.purple_squid_count = 0
        self.yellow_fish_caught = False

        self.player_in_water = False
        self.spawn_attempt_available = True
        self.world_frozen = False
        self.caught_by = None
        self.npc_timer = 0.0
        self.fish_timer = 0.0

        self.generate_npcs()
        self.set_reset_button(False)
        self.draw()

    def generate_npcs(self):
        candidates = list(range(2, ROWS - 2))
        random.shuffle(candidates)

        ys = []

        for y in candidates:
            if all(abs(y - old_y) >= 6 for old_y in ys):
                ys.append(y)

            if len(ys) == 3:
                break

        ys.sort()

        self.npcs = []

        for i, y in enumerate(ys):
            self.npcs.append({
                "x": random.randint(RIVER_X0, RIVER_X1),
                "y": y,
                "facing": random.choice([-1, 1]),
                "state": random.choice(["still", "move", "turn"]),
                "locked": False,
                "base": NPC_BASES[i],
            })
            
    def key_down(self, event):
        key = event.keysym.lower()
        if key == "f3":
            self.show_collision_debug = not self.show_collision_debug
            self.draw()
            return
            
        if key == "r":
            self.reset_game()
            return
        dx = dy = 0
        if key in ("left", "a"):
            dx = -1
        elif key in ("right", "d"):
            dx = 1
        elif key in ("up", "w"):
            dy = -1
        elif key in ("down", "s"):
            dy = 1
        if dx or dy:
            self.move_player(dx, dy)

    def move_player(self, dx, dy):
        nx = max(0, min(COLS - 1, self.player[0] + dx))
        ny = max(0, min(ROWS - 1, self.player[1] + dy))
        
        # Prevent movement into restricted polygons.
        if self.is_restricted(nx, ny):
            return
            
        if dx < 0:
            self.player_facing = "left"
        elif dx > 0:
            self.player_facing = "right"
        elif dy < 0:
            self.player_facing = "up"
        elif dy > 0:
            self.player_facing = "down"
            
        self.player_walk_frame = not self.player_walk_frame
        
        # Check whether the player is moving onto the fish.
        if self.fish is not None:
            if self.fish["x"] == nx and self.fish["y"] == ny:
                self.player = [nx, ny]
                self.catch_fish(self.fish["x"], self.fish["y"], "PLAYER")
                self.draw()
                return

        self.player = [nx, ny]

        in_water = nx >= RIVER_X0
        if in_water != self.player_in_water:
            self.player_walk_frame = False
            
        if not in_water and self.player_in_water:
            self.player_in_water = False
            self.spawn_attempt_available = True

        if in_water and not self.player_in_water:
            self.player_in_water = True
            self.spawn_attempt_available = False
            if self.fish is None and self.caught_fish is None and self.carried_fish is None:
                self.try_spawn_fish()

        self.check_player_front_catch()
        self.try_pick_up_caught_fish()
        self.try_deliver_fish()
        self.draw()
        
    def is_inside_polygon(self, x, y, polygon):
        inside = False

        j = len(polygon) - 1

        for i in range(len(polygon)):
            xi, yi = polygon[i]
            xj, yj = polygon[j]

            intersects = (
                (yi > y) != (yj > y)
                and x < (xj - xi) * (y - yi) / (yj - yi) + xi
            )

            if intersects:
                inside = not inside

            j = i

        return inside
        
    def is_restricted(self, x, y):
        # Check the center of the destination tile.
        px = x + 0.5
        py = y + 0.5

        for polygon in RESTRICTED_AREAS:
            if self.is_inside_polygon(px, py, polygon):
                return True

        return False
        
    def try_spawn_fish(self):
        if self.fish is not None or self.caught_fish is not None or self.carried_fish:
            return False

        highest = min(n["y"] for n in self.npcs)
        lowest = max(n["y"] for n in self.npcs)

        if not (highest <= self.player[1] <= lowest):
            return False

        x = random.randint(RIVER_X0, RIVER_X1)

        # Before the first yellow fish is caught, only fish can spawn.
        # Afterwards, there is a 50/50 chance of fish or squid.
        if not self.yellow_fish_caught:
            creature_type = "fish"
        else:
            creature_type = random.choice(["fish", "squid"])

        # The travelling creature is always displayed as the generic fish.
        # Its actual type and colour are revealed only when caught.
        self.fish = {
            "x": x,
            "y": 0,
            "kind": creature_type,
        }

        self.fish_timer = 0.0
        return True    
        
    def choose_fish_color(self):
        x = self.score

        orange = max(0.25 - 0.005 * x, 0)
        blue = 0.10
        purple = max(
            0.90 * math.sin((x * math.pi) / 15)
            - 0.20
            - 0.01 * x,
            0
        )
        yellow = min(0.0014 * x * math.sqrt(x), 0.5)
        red = max(1.0 - orange - blue - purple - yellow, 0)

        probabilities = [
            ("orange", "#f28c28", orange),
            ("blue", "#4c83c3", blue),
            ("purple", "#8d61b8", purple),
            ("yellow", "#e8c94c", yellow),
            ("red", "#d94b4b", red),
        ]

        r = random.random()
        cumulative = 0.0

        for name, color, probability in probabilities:
            cumulative += probability
            if r <= cumulative:
                return name, color

        return probabilities[-1][0], probabilities[-1][1]


    def choose_squid_color(self):
        r = random.random()
        cumulative = 0.0

        for name, color, probability in SQUID_COLORS:
            cumulative += probability
            if r <= cumulative:
                return name, color

        return SQUID_COLORS[-1][0], SQUID_COLORS[-1][1]
        
    def tick(self):
        now = time.monotonic()
        dt = min(now - self.last_time, 0.10)
        self.last_time = now
        if not self.world_frozen:
            self.npc_timer += dt
            self.fish_timer += dt
            while self.npc_timer >= NPC_DECISION_PERIOD:
                self.npc_timer -= NPC_DECISION_PERIOD
                self.update_npcs()
            # Catching is proximity/orientation based, not input based.
            self.check_player_front_catch()
            while self.fish is not None and self.fish_timer >= FISH_STEP_PERIOD:
                self.fish_timer -= FISH_STEP_PERIOD
                self.fish["y"] += 1
                self.check_fish_bottom()
                if self.fish is not None:
                    self.check_all_catches()
        self.draw()
        self.root.after(30, self.tick)

    def update_npcs(self):
        for npc in self.npcs:
            # The state/timing distribution is selected exactly the same way
            # with or without a fish.
            chosen_state = random.choices(
                ["still", "move", "turn"], weights=[0.50, 0.32, 0.18], k=1
            )[0]
            if self.fish is None:
                npc["locked"] = False
                npc["state"] = chosen_state
            else:
                fx = self.fish["x"]
                looking_toward_fish = (
                    npc["x"] < fx and npc["facing"] == 1
                ) or (
                    npc["x"] > fx and npc["facing"] == -1
                )
                if not npc["locked"] and looking_toward_fish:
                    npc["locked"] = True
                npc["state"] = chosen_state
                if npc["locked"]:
                    if npc["x"] < fx:
                        npc["facing"] = 1
                    elif npc["x"] > fx:
                        npc["facing"] = -1
            # If the fish is already one block ahead, catch it before the
            # NPC's next random movement decision.
            self.check_all_catches()
            if self.world_frozen:
                break
            if npc["state"] == "turn":
                if not npc["locked"]:
                    npc["facing"] *= -1
            elif npc["state"] == "move":
                nx = npc["x"] + npc["facing"]
                if RIVER_X0 <= nx <= RIVER_X1:
                    npc["x"] = nx
                else:
                    npc["facing"] *= -1
                    nx = npc["x"] + npc["facing"]
                    if RIVER_X0 <= nx <= RIVER_X1:
                        npc["x"] = nx
            if npc["locked"] and self.fish is not None:
                fx = self.fish["x"]
                crossed = (
                    npc["facing"] == 1 and npc["x"] >= fx
                ) or (
                    npc["facing"] == -1 and npc["x"] <= fx
                )
                if crossed:
                    npc["locked"] = False
            self.check_all_catches()
            if self.world_frozen:
                break

    def check_all_catches(self):
        if self.fish is None or self.world_frozen:
            return

        # An NPC can catch the fish only when it occupies the single block
        # immediately in front of the NPC. Being on the same row is not
        # sufficient.
        fx, fy = self.fish["x"], self.fish["y"]
        for npc in self.npcs:
            fish_immediately_in_front = (
                fy == npc["y"] and
                fx == npc["x"] + npc["facing"]
            )
            if fish_immediately_in_front:
                self.catch_fish(fx, fy, "NPC")
                return

        self.check_player_front_catch()

    def check_player_front_catch(self):
        if self.fish is None or self.world_frozen:
            return

        # The player catches the fish automatically only when it is in the
        # single block immediately in front of the player. Facing toward a
        # fish farther away is not sufficient.
        fx, fy = self.fish["x"], self.fish["y"]
        px, py = self.player
        fish_immediately_in_front = (
            (self.player_facing == "left" and fy == py and fx == px - 1) or
            (self.player_facing == "right" and fy == py and fx == px + 1) or
            (self.player_facing == "up" and fx == px and fy == py - 1) or
            (self.player_facing == "down" and fx == px and fy == py + 1)
        )
        if fish_immediately_in_front:
            self.catch_fish(fx, fy, "PLAYER")

    def catch_fish(self, x, y, caught_by):
        if self.fish is None:
            return

        creature_type = self.fish.get("kind", "fish")

        if creature_type == "squid":
            name, color = self.choose_squid_color()

        else:
            name, color = self.choose_fish_color()

            # Catching a yellow fish permanently unlocks squid spawning.
            if name == "yellow":
                self.yellow_fish_caught = True
        
        fish_state = {
            "x": x,
            "y": y,
            "kind": creature_type,
            "color": color,
            "name": name,
        }

        self.fish = None
        self.fish_timer = 0.0
        self.caught_by = caught_by

        if caught_by == "PLAYER":
            self.caught_fish = None
            self.carried_fish = fish_state
            self.set_reset_button(False)

        else:
            self.caught_fish = fish_state
            self.carried_fish = None
            self.world_frozen = True
            self.set_reset_button(True)
            
    def try_pick_up_caught_fish(self):
        # Player catches are already converted directly into carried_fish.
        return

    def try_deliver_fish(self):
        if self.carried_fish is None:
            return
        fx, fy = FISHERMAN_POS
        if abs(self.player[0] - fx) <= 1 and abs(self.player[1] - fy) <= 3:

            if (
                self.carried_fish.get("kind") == "squid"
                and self.carried_fish.get("name") == "purple"
            ):
                self.purple_squid_count += 1

            self.carried_fish = None
            self.caught_by = None
            self.score += 1

            # The player has completed this fish cycle. Leaving and re-entering
            # the river creates the next spawning opportunity.
            self.player_in_water = False
            self.spawn_attempt_available = True
            self.set_reset_button(False)

    def check_fish_bottom(self):
        if self.fish is not None and self.fish["y"] >= ROWS:
            self.fish = None
            self.fish_timer = 0.0
            # Re-start the spawning logic automatically. If the player is
            # still in the river but is vertically outside the NPC range,
            # no fish appears; leaving and re-entering the river arms a new
            # entry attempt.
            if self.player_in_water and self.caught_fish is None and self.carried_fish is None:
                self.try_spawn_fish()

    def draw(self):
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor="nw", image=self.assets["background"])
        self.draw_collision_debug()
        self.draw_npcs()
        self.draw_fish()
        self.draw_player()
        if self.carried_fish:
            self.draw_sprite_centered(
                self.creature_image(self.carried_fish),
                self.player[0],
                self.player[1]
            )
        self.draw_hud()

    def draw_sprite_centered(self, image, cx, cy, y_offset=0):
        self.canvas.create_image(
            cx * BLOCK + BLOCK // 2,
            cy * BLOCK + BLOCK // 2 + y_offset,
            anchor="center",
            image=image,
        )

    def draw_npcs(self):
        for npc in self.npcs:
            direction = "right" if npc["facing"] > 0 else "left"

            self.draw_sprite_centered(
                self.assets[f"{npc['base']}_{direction}.png"],
                npc["x"],
                npc["y"],
                4
            )
            
    def creature_image(self, creature):
        kind = creature.get("kind", "fish")
        name = creature.get("name", "orange")

        if kind == "squid":
            if name not in {"red", "blue", "purple", "yellow"}:
                name = "red"
            return self.assets[f"squid_{name}"]

        if name not in {"orange", "red", "yellow", "blue", "purple"}:
            name = "orange"

        return self.assets[f"fish_{name}"]
        
    def draw_fish(self):
        if self.fish:
            # The creature is still travelling through the water.
            # Its identity is hidden until it is caught.
            self.draw_sprite_centered(
                self.assets["fish"],
                self.fish["x"],
                self.fish["y"]
            )

        if self.caught_fish:
            self.draw_sprite_centered(
                self.creature_image(self.caught_fish),
                self.caught_fish["x"],
                self.caught_fish["y"]
            )

        if self.carried_fish:
            self.draw_sprite_centered(
                self.creature_image(self.carried_fish),
                self.player[0],
                self.player[1]
            )
            
    def draw_player(self):
        in_water = self.player[0] >= RIVER_X0

        if in_water:
            direction_map = {
                "left": "Player_water_left",
                "right": "Player_water_right",
                "up": "Player_water_back",
                "down": "Player_water_front",
            }

            sprite_name = direction_map[self.player_facing]

        else:
            if (
                self.player_facing in ("left", "right")
                and self.player_walk_frame
            ):
                sprite_name = f"Player_walk_{self.player_facing}"

            else:
                direction_map = {
                    "left": "Player_stand_left",
                    "right": "Player_stand_right",
                    "up": "Player_stand_back",
                    "down": "Player_stand_front",
                }

                sprite_name = direction_map[self.player_facing]

        self.draw_sprite_centered(
            self.assets[sprite_name],
            self.player[0],
            self.player[1]
        )
        
    def rounded_rect(self, x1, y1, x2, y2, r, fill, outline, width=3):
        # Scale coordinates
        x1, y1, x2, y2, r = [
            int(v * RENDER_SCALE) for v in (x1, y1, x2, y2, r)
        ]
        width = max(1, int(width * RENDER_SCALE))

        points = [
            x1+r, y1,
            x2-r, y1,
            x2, y1,
            x2, y1+r,
            x2, y2-r,
            x2, y2,
            x2-r, y2,
            x1+r, y2,
            x1, y2,
            x1, y2-r,
            x1, y1+r,
            x1, y1
        ]

        self.canvas.create_polygon(
            points,
            smooth=True,
            splinesteps=36,
            fill=fill,
            outline=outline,
            width=width,
            joinstyle="round"
        )
        
    def draw_hud(self):
        # Counter and Reset are drawn in the same design coordinates as the
        # mockup, then rendered at 50%, just like the sprites/background.
        self.rounded_rect(34, 24, 304, 104, 18, "#f7f2df", "#43506c", 4)
        self.canvas.create_text(int(169*RENDER_SCALE), int(64*RENDER_SCALE),
                                text=f"魚 {self.score}", fill="#303047",
                                font=("TkDefaultFont", 15, "bold"))
        self.rounded_rect(314, 24, 584, 104, 18, "#f7f2df", "#43506c", 4)
        self.canvas.create_text(int(449*RENDER_SCALE), int(64*RENDER_SCALE),
                                text=f"金魚 {self.purple_squid_count}",
                                fill="#303047",
                                font=("TkDefaultFont", 15, "bold"))

        x1, y1, x2, y2 = 28, 1022, 236, 1104
        self.rounded_rect(x1+5, y1+6, x2+5, y2+6, 12, "#744b2d", "#744b2d", 2)
        button_color = "#f6a52f" if self.world_frozen else "#bdbdbd"
        self.rounded_rect(x1, y1, x2, y2, 12, button_color, "#fff0c8", 4)
        self.canvas.create_text(int((x1+x2)//2*RENDER_SCALE), int((y1+y2)//2*RENDER_SCALE),
                                text="重新開始", fill="#30251e", font=("TkDefaultFont", 15, "bold"))

        if self.world_frozen:
            box_width = 1280 - (RIVER_X0 * SOURCE_BLOCK + 40)
            box_height = 70

            x1 = 640 - box_width / 2
            x2 = 640 + box_width / 2
            y1 = 576 - box_height / 2
            y2 = 576 + box_height / 2

            self.rounded_rect(
                x1, y1, x2, y2,
                12,
                "#f7f2df",
                "#a95035",
                3
            )

            self.canvas.create_text(
                int(640 * RENDER_SCALE),
                int(576 * RENDER_SCALE),
                text="抓到魚了!",
                fill="#a95035",
                font=("TkDefaultFont", 10, "bold")
            )
            
        if self.carried_fish:
            self.rounded_rect(430, 1076, 850, 1118, 10, "#f7f2df", "#4d5b67", 2)
            self.canvas.create_text(int(640*RENDER_SCALE), int(1097*RENDER_SCALE),
                                    text="「把魚帶到市場攤位」", fill="#2e2a27",
                                    font=("TkDefaultFont", 12, "bold"))

    def set_reset_button(self, caught):
        # The Reset button is rendered directly on the canvas.
        return

def main():
    # Keep the program runnable when launched by double-clicking on Windows.
    # All graphical resources are resolved relative to this .py file.
    root = tk.Tk()
    try:
        WoyaoYu(root)
    except Exception as exc:
        root.withdraw()
        try:
            from tkinter import messagebox
            messagebox.showerror("woyaoyu", f"The game could not start:\n\n{exc}")
        finally:
            root.destroy()
        raise
    root.mainloop()

if __name__ == "__main__":
    main()
