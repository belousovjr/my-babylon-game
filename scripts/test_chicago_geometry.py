"""Run with python3 -m unittest discover -s scripts -p 'test_*.py'."""
import importlib.util
import unittest
from pathlib import Path
from shapely.geometry import Polygon, LineString, box
from shapely.ops import unary_union
from shapely import set_precision

spec=importlib.util.spec_from_file_location('city',Path(__file__).with_name('build-chicago.py'))
city=importlib.util.module_from_spec(spec)
spec.loader.exec_module(city)

class StreetGeometryTests(unittest.TestCase):
    def test_concave_sidewalk_and_hole_have_no_missing_triangles(self):
        shapes=[Polygon([(0,0),(9,0),(9,9),(6,9),(6,2),(3,2),(3,9),(0,9)]),
                Polygon([(0,0),(20,0),(20,20),(0,20)],holes=[[(2,3),(16,4),(12,17),(4,12)]])]
        for shape in shapes:
            result=unary_union([Polygon(t) for t in city.triangles(shape)])
            self.assertLess(set_precision(shape,0.01).symmetric_difference(result).area,1e-6)

    def test_curb_follows_both_sides_of_closed_block_without_gaps(self):
        road=LineString([(0,0),(30,0),(30,30),(0,30),(0,0)]).buffer(3,join_style=2)
        curb=road.buffer(.22,join_style=2).difference(road)
        self.assertEqual(len(city.rings(road)),2)
        self.assertEqual(len(city.rings(curb)),4)
        result=unary_union([Polygon(t) for t in city.triangles(curb)])
        self.assertLess(set_precision(curb,0.01).symmetric_difference(result).area,1e-6)
        self.assertLess(result.intersection(road).area,1e-6)
        self.assertTrue(all(r[0]==r[-1] for r in city.rings(curb)))

    def test_near_duplicate_boundary_vertices_are_snapped_before_triangulation(self):
        shape=Polygon([(0,0),(100,0),(100,20),(0.00001,20),(0,19.99999)])
        faces=city.triangles(shape)
        self.assertEqual(len(faces),2)
        self.assertEqual(sum(Polygon(t).area for t in faces),2000)

    def test_generated_ground_does_not_overlap_paving(self):
        import json
        data=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        paving=unary_union([Polygon(t) for key in ['roadSurface','sidewalks','curbs'] for t in data[key]])
        ground=unary_union([Polygon(t) for cell in data['terrain'] for t in cell['triangles']])
        self.assertLess(ground.intersection(paving).area,0.01)

    def test_sidewalk_uses_one_contour_at_unequal_width_junction(self):
        roads=[dict(points=[[-30,0],[0,0],[30,0]],width=14),
               dict(points=[[0,0],[2,30]],width=8)]
        asphalt,sidewalk,pavement=city.street_surfaces(roads,box(-40,-40,40,40))
        self.assertTrue(asphalt.is_valid and sidewalk.is_valid)
        self.assertLess(asphalt.intersection(sidewalk).area,1e-6)
        self.assertLess(pavement.symmetric_difference(asphalt.union(sidewalk)).area,1e-6)
        # Every street edge inside the map has a full sidewalk band, including way ends.
        self.assertLess(asphalt.buffer(2.9,join_style=3).difference(pavement).area,1e-6)

    def test_narrow_ground_spike_is_absorbed_into_intersection(self):
        roads=[dict(points=[[-20,0],[20,0]],width=10),
               dict(points=[[0,0],[20,1]],width=8)]
        asphalt,sidewalk,_=city.street_surfaces(roads,box(-30,-30,30,30))
        self.assertTrue(asphalt.is_valid and sidewalk.is_valid)
        self.assertTrue(asphalt.covers(Polygon([(0,4),(10,4),(10,4.4)])))
