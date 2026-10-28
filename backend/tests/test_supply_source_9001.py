"""Regression tests for the 9001 Source maintenance spare-part option.

Run from backend/: ./venv/bin/python3 -m unittest discover -s tests -p 'test_supply_source_9001.py'
No database mutation occurs in these tests.
"""
import unittest

from pydantic import ValidationError
from maintenance_routes import (
    PartLine,
    DIRECT_USE_KINDS,
    _part_source,
    _part_uses_inventory,
    _total_cost,
)
from pdf_report import _shows_cost


class SupplySource9001Tests(unittest.TestCase):
    def test_source_is_accepted_and_not_inventory_deducted(self):
        line = PartLine(item_id="test-part", qty=2, supply_source="9001 Source")
        self.assertEqual(line.supply_source, "9001 Source")
        self.assertEqual(_part_source(line.model_dump()), "9001 Source")
        self.assertFalse(_part_uses_inventory(line.model_dump()))
        self.assertEqual(DIRECT_USE_KINDS["9001 Source"], "9001_source")

    def test_direct_use_value_and_pdf_cost(self):
        p = {"supply_source": "9001 Source", "cost": 250.0}
        self.assertTrue(_shows_cost(p))
        self.assertEqual(_total_cost([p]), 250.0)

    def test_old_sources_unchanged(self):
        self.assertTrue(_part_uses_inventory({"supply_source": "Ex-Stock"}))
        self.assertFalse(_part_uses_inventory({"supply_source": "Purchase"}))
        self.assertFalse(_part_uses_inventory({"supply_source": "Warehouse"}))
        self.assertFalse(_shows_cost({"supply_source": "Ex-Stock"}))
        self.assertEqual(DIRECT_USE_KINDS["Purchase"], "purchase")
        self.assertEqual(DIRECT_USE_KINDS["Warehouse"], "warehouse")

    def test_unknown_source_not_permitted(self):
        with self.assertRaises(ValidationError):
            PartLine(item_id="test-part", qty=1, supply_source="Unknown")


if __name__ == "__main__":
    unittest.main()
