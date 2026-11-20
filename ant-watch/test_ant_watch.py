"""Offline tests: synthetic price patterns must be classified the way a human would expect."""
import math
import random
import unittest

import ant_watch as aw


def make_bars(closes, noise=0.002, seed=1):
    rnd = random.Random(seed)
    b = {k: [] for k in "tohlcv"}
    prev = closes[0]
    for i, c in enumerate(closes):
        spread = abs(c) * noise
        o = prev
        b["t"].append(1_700_000_000 + i * 900)
        b["o"].append(o)
        b["h"].append(max(o, c) + spread * rnd.random())
        b["l"].append(min(o, c) - spread * rnd.random())
        b["c"].append(c)
        b["v"].append(1000 + rnd.randint(0, 200))
        prev = c
    return b


class Indicators(unittest.TestCase):
    def test_rsi_extremes(self):
        up = [100 + i for i in range(40)]
        self.assertGreater(aw.rsi(up)[-1], 95)
        self.assertLess(aw.rsi(up[::-1])[-1], 5)

    def test_ema_matches_sma_seed(self):
        vals = list(range(1, 30))
        self.assertAlmostEqual(aw.ema(vals, 5)[4], 3.0)


class Classify(unittest.TestCase):
    def test_warming_up(self):
        self.assertEqual(aw.analyze(make_bars([100] * 10))["state"], "WARMING_UP")

    def test_rising(self):
        rnd = random.Random(2)
        closes = [100 * (1.004 ** i) * (1 + rnd.uniform(-0.002, 0.002)) for i in range(80)]
        self.assertEqual(aw.analyze(make_bars(closes))["state"], "RISING")

    def test_falling(self):
        rnd = random.Random(3)
        closes = [100 * (0.996 ** i) * (1 + rnd.uniform(-0.002, 0.002)) for i in range(80)]
        self.assertEqual(aw.analyze(make_bars(closes))["state"], "FALLING")

    def test_stable_after_wild_ipo(self):
        rnd = random.Random(4)
        wild = [100 + 8 * math.sin(i / 1.5) + rnd.uniform(-4, 4) for i in range(40)]
        calm = [100 + rnd.uniform(-0.3, 0.3) for _ in range(40)]
        self.assertEqual(aw.analyze(make_bars(wild + calm, noise=0.001))["state"], "STABLE")

    def test_volatile(self):
        rnd = random.Random(5)
        calm = [100 + rnd.uniform(-0.3, 0.3) for _ in range(60)]
        wild = [100 + (6 if i % 2 else -6) + rnd.uniform(-2, 2) for i in range(20)]
        self.assertEqual(aw.analyze(make_bars(calm + wild, noise=0.01))["state"], "VOLATILE")


class StateMachine(unittest.TestCase):
    def test_needs_two_checks_before_alert(self):
        s, a = aw.step({}, {"state": "NORMAL"}, None, "d")
        self.assertEqual((s["confirmed"], a), ("NORMAL", []))  # first run: no alert
        s, a = aw.step(s, {"state": "STABLE"}, None, "d")
        self.assertEqual((s["confirmed"], a), ("NORMAL", []))  # seen once: pending only
        s, a = aw.step(s, {"state": "STABLE"}, None, "d")
        self.assertEqual(s["confirmed"], "STABLE")
        self.assertEqual(len(a), 1)
        self.assertIn("Stable", a[0])

    def test_flip_flop_does_not_alert(self):
        s, _ = aw.step({}, {"state": "NORMAL"}, None, "d")
        for st in ["STABLE", "NORMAL", "STABLE", "NORMAL"]:
            s, a = aw.step(s, {"state": st}, None, "d")
            self.assertEqual(a, [])

    def test_breakout_message(self):
        s = {"confirmed": "STABLE"}
        s, _ = aw.step(s, {"state": "RISING", "volume_ratio": 2.0}, None, "d")
        s, a = aw.step(s, {"state": "RISING", "volume_ratio": 2.0}, None, "d")
        self.assertIn("breaking out", a[0])

    def test_big_move_once_per_day(self):
        s, a = aw.step({"confirmed": "NORMAL"}, {"state": "NORMAL"}, 6.0, "d1")
        self.assertEqual(len(a), 1)
        s, a = aw.step(s, {"state": "NORMAL"}, 7.0, "d1")
        self.assertEqual(a, [])
        s, a = aw.step(s, {"state": "NORMAL"}, 6.0, "d2")
        self.assertEqual(len(a), 1)

    def test_rsi_cross(self):
        s, a = aw.step({"confirmed": "NORMAL"}, {"state": "NORMAL", "rsi": 50}, None, "d")
        s, a = aw.step(s, {"state": "NORMAL", "rsi": 75}, None, "d")
        self.assertIn("overheated", a[0])
        s, a = aw.step(s, {"state": "NORMAL", "rsi": 78}, None, "d")
        self.assertEqual(a, [])


class Watchlist(unittest.TestCase):
    def test_parse(self):
        wl = aw.parse_watchlist("ANT:Anthropic:83, nvda:NVIDIA ,SPCX:SpaceX:135")
        self.assertEqual([w["symbol"] for w in wl], ["ANT", "NVDA", "SPCX"])
        self.assertEqual((wl[0]["ipo"], wl[1]["ipo"], wl[2]["name"]), (83.0, None, "SpaceX"))

    def test_falls_back_when_site_unreachable(self):
        old = aw.WATCHLIST_URL
        try:
            aw.WATCHLIST_URL = "http://127.0.0.1:9/nothing-here"
            self.assertEqual([w["symbol"] for w in aw.load_watchlist()], ["ANT", "NVDA", "SPCX"])
        finally:
            aw.WATCHLIST_URL = old

    def test_alerts_name_the_ticker(self):
        s, _ = aw.step({}, {"state": "NORMAL"}, None, "d", "NVDA")
        s, a = aw.step(s, {"state": "NORMAL"}, 6.0, "d", "NVDA")
        self.assertIn("NVDA is up", a[0])


class EndToEnd(unittest.TestCase):
    def test_parse_and_render(self):
        rnd = random.Random(6)
        closes = [97 + rnd.uniform(-1, 1) for _ in range(50)]
        b = make_bars(closes)
        payload = {"chart": {"result": [{"meta": {"regularMarketPrice": closes[-1]}, "timestamp": b["t"] + [b["t"][-1] + 900],
                   "indicators": {"quote": [{"open": b["o"] + [None], "high": b["h"] + [None], "low": b["l"] + [None],
                                             "close": b["c"] + [None], "volume": b["v"] + [None]}]}}]}}
        intraday = aw.parse_chart(payload)
        self.assertEqual(len(intraday["c"]), 50)  # null bar dropped
        daily = make_bars([83, 97.17, closes[-1]])
        state, alerts, res, quote = aw.run(intraday, daily, {})
        body = aw.render(state, res, quote, [], "someone", "ANT", "Anthropic", 83)
        self.assertIn("Anthropic (ANT) is", body)
        self.assertIn("vs IPO price $83", body)
        self.assertNotIn("IPO", aw.render(state, res, quote, [], "", "NVDA", "NVIDIA", None).split("<details>")[0])
        self.assertEqual(aw.load_state(body)["confirmed"], state["confirmed"])
        self.assertIsNone(aw.run(intraday, daily, state))  # same data again -> skipped


if __name__ == "__main__":
    unittest.main()
