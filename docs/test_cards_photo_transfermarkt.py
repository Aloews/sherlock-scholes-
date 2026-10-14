#!/usr/bin/env python3
"""Offline tests for Transfermarkt portrait URL validation."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cards_photo_transfermarkt import portrait_url


class TransfermarktPortraitTests(unittest.TestCase):
    def test_accepts_real_versioned_portrait(self):
        html = '<meta property="og:image" content="https://img.a.transfermarkt.technology/portrait/big/574671-1757664768.jpg">'
        self.assertEqual(
            portrait_url(html),
            "https://img.a.transfermarkt.technology/portrait/big/574671-1757664768.jpg",
        )

    def test_rejects_default_placeholder(self):
        html = '<meta property="og:image" content="https://img.a.transfermarkt.technology/portrait/big/default.jpg">'
        self.assertIsNone(portrait_url(html))

    def test_rejects_missing_or_empty_og_image(self):
        self.assertIsNone(portrait_url("<html></html>"))
        self.assertIsNone(portrait_url('<meta property="og:image" content="">'))


if __name__ == "__main__":
    unittest.main()
