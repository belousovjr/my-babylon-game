"""Run with python3 -m unittest discover -s scripts -p 'test_*.py'."""
import importlib.util
import unittest
from pathlib import Path
from shapely.geometry import Polygon, LineString, Point, box
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
            self.assertLess(shape.symmetric_difference(result).area,1e-6)

    def test_curb_follows_both_sides_of_closed_block_without_gaps(self):
        road=LineString([(0,0),(30,0),(30,30),(0,30),(0,0)]).buffer(3,join_style=2)
        curb=road.buffer(.22,join_style=2).difference(road)
        self.assertEqual(len(city.rings(road)),2)
        self.assertEqual(len(city.rings(curb)),4)
        result=unary_union([Polygon(t) for t in city.triangles(curb)])
        self.assertLess(curb.symmetric_difference(result).area,1e-6)
        self.assertLess(result.intersection(road).area,1e-6)
        self.assertTrue(all(r[0]==r[-1] for r in city.rings(curb)))

    def test_triangulation_preserves_shared_boundary_vertices(self):
        shape=Polygon([(0,0),(100,0),(100,20),(0.00001,20),(0,19.99999)])
        result=unary_union([Polygon(t) for t in city.triangles(shape)])
        self.assertLess(shape.symmetric_difference(result).area,1e-9)

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

    def test_plaza_pools_do_not_generate_river_pits_or_terraces(self):
        import json
        data=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        river=unary_union([Polygon(t) for key in ['water','riverwalk'] for t in data[key]])
        ground=unary_union([Polygon(t) for cell in data['terrain'] for t in cell['triangles']])
        for x,z in [(600.75,129.48),(632.49,129.78)]:
            point=Point(x,z)
            self.assertGreater(river.distance(point),20)
            self.assertTrue(ground.covers(point),'small plaza pools must leave the ground intact')

    def test_untyped_elevated_structures_do_not_become_estimated_towers(self):
        self.assertTrue(city.unsupported_elevated_building(dict(building='yes',layer='3')))
        for tags in [dict(building='yes'),dict(building='office',layer='1'),
                     dict(building='yes',layer='3',height='20'),
                     dict(building='yes',layer='3',name='Named building'),
                     {'building':'yes','layer':'3','building:levels':'4'}]:
            self.assertFalse(city.unsupported_elevated_building(tags))
        import json
        objects=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['world']['objects']
        self.assertFalse({'osm-w1175853280','osm-w1175853281'} & {o['id'] for o in objects})

    def test_quay_walls_share_terrace_edges_and_bridges_stay_over_water(self):
        import json
        data=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        water=unary_union([Polygon(t) for t in data['water']])
        terrace=unary_union([Polygon(t) for t in data['riverwalk']])
        walls=unary_union([LineString(r) for key in ['shorelines','terraceWalls'] for r in data[key]])
        self.assertLess(terrace.boundary.difference(walls.buffer(0.02)).length,0.01)
        bridge=unary_union([Polygon(t) for t in data['bridgeDeck']])
        self.assertGreater(bridge.area,100)
        self.assertLess(bridge.difference(water.buffer(9.1)).area,0.01)
        self.assertGreater(len(data['bridgeRails']),0)
        for line in data['bridgeRails']:
            rail=LineString(line)
            self.assertLess(rail.difference(bridge.boundary.buffer(0.02)).length,0.01)
            self.assertGreater(rail.distance(water.buffer(7,join_style=3).boundary),0.4)

    def test_bridge_structure_covers_approaches_and_has_bank_abutments(self):
        import json
        data=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        water=unary_union([Polygon(t) for t in data['water']])
        paving=unary_union([Polygon(t) for k in ['roadSurface','sidewalks','curbs'] for t in data[k]])
        bridge=unary_union([Polygon(t) for t in data['bridgeDeck']])
        approaches=paving.intersection(water.buffer(6.9,join_style=3))
        self.assertLess(approaches.difference(bridge.buffer(0.02)).area,0.01)
        supports=unary_union([Polygon(r) for r in data['bridgeAbutments']])
        self.assertGreater(supports.area,100)
        self.assertLess(supports.difference(bridge.buffer(0.02)).area,0.01)
        self.assertLess(supports.intersection(water.buffer(-0.02)).area,0.01)

    def test_generated_surfaces_cover_map_and_all_paving_edges_have_sides(self):
        import json
        data=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        terrain=unary_union([Polygon(t) for cell in data['terrain'] for t in cell['triangles']])
        regions=[terrain]+[unary_union([Polygon(t) for t in data[key]]) for key in ['roadSurface','sidewalks','curbs','water','riverwalk']]
        missing=box(*data['bounds']).difference(unary_union(regions))
        self.assertLess(missing.area,1e-5,'no horizontal gaps anywhere in the generated map')
        for key,edge,height in zip(['roadSurface','sidewalks','curbs'],data['pavingEdges'],[.03,.16,.18]):
            surface=unary_union([Polygon(t) for t in data[key]])
            sides=unary_union([LineString(line) for line in edge['lines']])
            self.assertEqual(edge['top'],height)
            self.assertLess(surface.boundary.difference(sides.buffer(1e-6)).length,1e-5,'no exposed vertical edge')

    def test_metro_classification_excludes_mainline_rail_and_tunnels(self):
        tags=dict(railway='subway',operator='Chicago Transit Authority',layer='2',bridge='yes')
        self.assertTrue(city.elevated_metro(tags))
        self.assertFalse(city.elevated_metro(dict(tags,tunnel='yes')))
        self.assertFalse(city.elevated_metro(dict(tags,service='siding')))
        self.assertFalse(city.elevated_metro(dict(railway='rail',operator='Union Pacific Railroad',layer='1')))

    def test_metro_deck_joins_short_fragments_parallel_tracks_and_corners(self):
        lines=[LineString([(0,0),(1,0)]),LineString([(1,0),(30,0),(30,30)]),
               LineString([(0,3),(27,3),(27,30)])]
        result=city.railway_geometry(lines,box(-5,-5,35,35),Polygon())
        deck=unary_union([Polygon(t) for t in result['deck']])
        self.assertEqual(deck.geom_type,'Polygon','shared platform instead of separate track boxes')
        for line in lines:self.assertTrue(deck.buffer(1e-6).covers(line))
        self.assertGreater(len(result['rails']),0)

    def test_generated_metro_is_connected_and_clear_of_buildings(self):
        import json
        from shapely.affinity import rotate,translate
        data=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())
        rail=data['environment']['railway']
        deck=unary_union([Polygon(t) for t in rail['deck']])
        self.assertEqual(deck.geom_type,'Polygon','Loop and its approaches form one continuous deck')
        for o in data['world']['objects']:
            w,h,d=o['size'];x,y,z=o['position']
            visual=translate(rotate(box(-w*.515,-d*.515,w*.515,d*.515),-o['yaw'],origin=(0,0),use_radians=True),x,z)
            self.assertLess(visual.intersection(deck).area,1e-6,o['id'])
        self.assertGreater(len(rail['supports']),10)

    def test_building_fit_preserves_grid_and_leaves_track_corridor_clear(self):
        corridor=box(4,-30,8,30)
        o=dict(position=[0,10,0],size=[20,20,20],yaw=0)
        result=city.fit_building(o,box(-30,-30,30,30).difference(corridor))
        self.assertIsNotNone(result)
        w,h,d=result['size'];x,y,z=result['position']
        self.assertLess(box(x-w/2,z-d/2,x+w/2,z+d/2).intersection(corridor).area,1e-6)
        self.assertEqual(y-h/2,0)
        self.assertEqual(x,round(x))
        self.assertEqual(w*4,round(w*4))

    def test_every_generated_building_is_supported_and_clear_of_roads_and_sidewalks(self):
        import json
        data=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())
        env=data['environment']
        ground=unary_union([Polygon(t) for cell in env['terrain'] for t in cell['triangles']])
        pavement=unary_union([Polygon(t) for key in ['roadSurface','sidewalks','curbs'] for t in env[key]])
        for o in data['world']['objects']:
            footprint=city.building_footprint(o)
            self.assertLess(footprint.difference(ground).area,1e-6,o['id']+' lacks ground support')
            self.assertLess(footprint.intersection(pavement).area,1e-6,o['id']+' overlaps street paving')
            self.assertEqual(o['position'][1]-o['size'][1]/2,0)

    def test_buildings_fit_shoreline_steps_without_overhanging(self):
        land=box(-30,-30,4,30)
        o=dict(position=[0,10,0],size=[20,20,20],yaw=0)
        fitted=city.fit_building(o,land)
        self.assertIsNotNone(fitted)
        self.assertTrue(land.covers(city.building_footprint(fitted)))
        self.assertLess(fitted['size'][0]*fitted['size'][2],400)
        self.assertIsNone(city.fit_building(o,box(-1,-1,1,1)))

    def test_landmark_ensemble_keeps_identical_size_and_relative_layout(self):
        objects=[dict(id='a',position=[0,20,0],size=[20,40,20],yaw=.3),
                 dict(id='b',position=[30,20,0],size=[20.25,40,19.75],yaw=1.2)]
        land=box(-100,20,100,100)
        fitted=city.fit_landmark_group(objects,land,identical=True)
        self.assertEqual(fitted[0]['size'],fitted[1]['size'])
        self.assertEqual(fitted[0]['yaw'],fitted[1]['yaw'])
        self.assertEqual(fitted[1]['position'][0]-fitted[0]['position'][0],30)
        self.assertEqual(fitted[1]['position'][2]-fitted[0]['position'][2],0)
        for original,o in zip(objects,fitted):
            self.assertTrue(land.covers(city.building_footprint(o)))
            self.assertLessEqual(abs(original['position'][2]-o['position'][2]),32)
        with self.assertRaises(RuntimeError):
            city.fit_landmark_group(objects,box(-1,-1,1,1),identical=True)

    def test_landmarks_survive_and_marina_pair_is_identical(self):
        import json
        data=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())
        objects=data['world']['objects'];ids={o['id'] for o in objects}
        self.assertTrue(set(data['report']['protectedBuildings'])<=ids)
        self.assertEqual(data['report']['heights']['landmark-reference'],7)
        twins=[o for o in objects if o['templateId']=='marina']
        self.assertEqual(len(twins),2)
        self.assertEqual(twins[0]['size'],twins[1]['size'])
        self.assertEqual(twins[0]['yaw'],twins[1]['yaw'])
        self.assertEqual(twins[0]['position'][1],twins[1]['position'][1])
        for a in objects:
            if a['id'] not in data['report']['protectedBuildings']:continue
            footprint=city.building_footprint(a)
            for b in objects:
                if a['id']!=b['id']:
                    self.assertLess(footprint.intersection(city.building_footprint(b)).area,1e-6,a['id']+' overlaps '+b['id'])
