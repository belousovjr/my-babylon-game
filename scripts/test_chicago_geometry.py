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

    def test_short_missing_connection_is_joined_but_remote_stubs_are_removed(self):
        roads=[dict(points=[[-100,0],[100,0]],width=9),dict(points=[[0,8],[0,80]],width=9),
               dict(points=[[200,0],[220,0]],width=9)]
        cleaned=city.clean_roads(roads,box(-100,-100,300,100))
        network=unary_union([LineString(r['points']) for r in cleaned])
        self.assertLess(network.distance(Point(0,4)),1e-6)
        self.assertGreater(network.distance(Point(210,0)),100)

    def test_tiny_traffic_islands_and_isolated_asphalt_are_removed(self):
        roads=[dict(points=[[0,0],[30,0],[30,30],[0,30],[0,0]],width=24),
               dict(points=[[100,0],[110,0]],width=5)]
        asphalt,_,_=city.street_surfaces(roads,box(-50,-50,150,100))
        self.assertEqual(asphalt.geom_type,'Polygon')
        self.assertEqual(len(asphalt.interiors),0)
        self.assertFalse(asphalt.covers(Point(105,0)))

    def test_generated_street_surface_is_connected_without_microscopic_islands(self):
        import json, math
        env=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        asphalt=unary_union([Polygon(t) for t in env['roadSurface']])
        sidewalks=unary_union([Polygon(t) for key in ['sidewalks','curbs'] for t in env[key]])
        self.assertEqual(asphalt.geom_type,'Polygon')
        self.assertTrue(all(Polygon(r).area>=64-1e-6 for r in asphalt.interiors))
        parts=list(sidewalks.geoms) if hasattr(sidewalks,'geoms') else [sidewalks]
        self.assertTrue(all(p.area>=64-1e-6 for p in parts))
        coverage=city.prep(asphalt.buffer(.05))
        for road in env['roads']:
            self.assertTrue(coverage.covers(LineString(road['points'])))

    def test_short_internal_dead_end_is_pruned_without_removing_longer_streets(self):
        roads=[dict(points=[[-100,0],[100,0]],width=9),dict(points=[[0,0],[0,10]],width=9),
               dict(points=[[0,10],[0,20]],width=9)]
        cleaned=city.clean_roads(roads,box(-100,-100,100,100))
        network=unary_union([LineString(r['points']) for r in cleaned])
        self.assertGreater(network.distance(Point(0,15)),10)
        self.assertLess(network.distance(Point(40,0)),1e-6)

    def test_short_return_loop_is_removed_without_breaking_main_street(self):
        roads=[dict(points=[[0,-100],[0,100]],width=9),
               dict(points=[[0,0],[-10,0],[-10,2],[0,2]],width=9)]
        cleaned=city.clean_roads(roads,box(-100,-100,100,100))
        network=unary_union([LineString(r['points']) for r in cleaned])
        self.assertGreater(network.distance(Point(-10,1)),9)
        self.assertLess(network.distance(Point(0,1)),1e-6)

    def test_supports_use_sidewalk_corners_instead_of_intersection_lanes(self):
        asphalt=unary_union([box(-5,-50,5,50),box(-50,-5,50,5)])
        sidewalks=asphalt.buffer(3.2).difference(asphalt)
        supports=city.place_railway_supports([[0,0],[-3,20]],sidewalks,asphalt,Polygon(),box(-3,-50,3,50),Polygon())
        self.assertEqual(len(supports),2)
        for support in supports:
            x,y,z=support['position']
            footprint=box(x-.175,z-.175,x+.175,z+.175)
            self.assertTrue(sidewalks.covers(footprint))
            self.assertLess(footprint.intersection(asphalt).area,1e-6)
            self.assertLessEqual(Point(x,z).distance(asphalt.boundary),1.5+1e-6)
            self.assertGreaterEqual(support['top'],6)

    def test_all_railway_supports_clear_asphalt_and_connect_to_deck(self):
        import json, math
        env=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        asphalt=unary_union([Polygon(t) for t in env['roadSurface']])
        sidewalk=unary_union([Polygon(t) for key in ['sidewalks','curbs'] for t in env[key]])
        deck=unary_union([Polygon(t) for t in env['railway']['deck']])
        self.assertGreater(len(env['railway']['supports']),10)
        ground=unary_union([Polygon(t) for cell in env['terrain'] for t in cell['triangles']])
        supports=env['railway']['supports']
        for i,support in enumerate(supports):
            x,base,z=support['position'];point=Point(x,z)
            peer=supports[i^1]['position']
            angle=math.atan2(peer[2]-z,peer[0]-x)
            foot=city.translate(city.rotate(box(-.325,-.325,.325,.325),angle,origin=(0,0),use_radians=True),x,z)
            self.assertTrue((sidewalk if base==.16 else ground).covers(foot))
            self.assertLess(foot.intersection(asphalt).area,1e-6)
            self.assertIn(base,[0,.16])
            self.assertGreaterEqual(support['top'],6)
            self.assertLess(deck.distance(Point(support['attachment'])),1e-6)
            self.assertLessEqual(point.distance(Point(support['attachment'])),4)

    def test_support_frames_require_two_safe_sides(self):
        asphalt=box(-5,-50,5,50)
        sidewalks=asphalt.buffer(3.2).difference(asphalt)
        deck=box(-3,-50,3,50)
        self.assertEqual(city.place_railway_supports([[-3,20]],sidewalks.intersection(box(-50,-50,0,50)),asphalt,Polygon(),deck,Polygon()),[])

    def test_generated_support_pairs_are_aligned_across_the_deck(self):
        import json, math
        env=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        supports=env['railway']['supports']
        self.assertEqual(len(supports)%2,0)
        self.assertGreater(len(supports),20)
        for a,b in zip(supports[::2],supports[1::2]):
            pa,pb=a['position'],b['position']
            beam=LineString([(pa[0],pa[2]),(pb[0],pb[2])])
            self.assertGreaterEqual(beam.length,2)
            self.assertEqual(a['top'],b['top'])
            for support in [a,b]:
                self.assertLessEqual(beam.distance(Point(support['attachment'])),4+1e-6)
                self.assertLessEqual(abs(support['skew']),10)
            self.assertLessEqual(beam.length,14)
            self.assertGreater(Point(a['attachment']).distance(Point(b['attachment'])),2)

    def test_dense_candidates_cover_bends_without_unnecessary_support_gaps(self):
        centre=LineString([(0,0),(0,40),(10,60),(40,70),(80,70)])
        deck=centre.buffer(2.1,cap_style=2,join_style=2)
        asphalt=centre.buffer(5,cap_style=2,join_style=3)
        sidewalks=asphalt.buffer(3.2).difference(asphalt)
        points=[]
        for ring in city.rings(deck):
            edge=LineString(ring)
            points.extend(list(edge.interpolate(d).coords)[0] for d in range(4,int(edge.length),4))
        supports=city.place_railway_supports(points,sidewalks,asphalt,Polygon(),deck,Polygon())
        centres=unary_union([Point((a['position'][0]+b['position'][0])/2,(a['position'][2]+b['position'][2])/2) for a,b in zip(supports[::2],supports[1::2])])
        for distance in range(8,int(centre.length)-8,4):
            self.assertLess(centre.interpolate(distance).distance(centres),30)

    def test_generated_urban_railway_has_no_avoidable_long_unsupported_sections(self):
        import json
        env=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        supports=env['railway']['supports']
        centres=unary_union([Point((a['position'][0]+b['position'][0])/2,(a['position'][2]+b['position'][2])/2) for a,b in zip(supports[::2],supports[1::2])])
        asphalt=unary_union([Polygon(t) for t in env['roadSurface']])
        sidewalk=unary_union([Polygon(t) for key in ['sidewalks','curbs'] for t in env[key]])
        water=unary_union([Polygon(t) for t in env['water']]).buffer(7)
        ground=unary_union([Polygon(t) for cell in env['terrain'] for t in cell['triangles']])
        deck=unary_union([Polygon(t) for t in env['railway']['deck']])
        points=[]
        for ring in env['railway']['edges']:
            edge=LineString(ring)
            points.extend(edge.interpolate(distance).coords[0] for distance in range(0,int(edge.length),8))
        for pair in city.railway_support_candidates(points,sidewalk,asphalt,water,deck,ground):
            a,b=pair[0]['position'],pair[1]['position']
            point=Point((a[0]+b[0])/2,(a[2]+b[2])/2)
            self.assertLess(point.distance(centres),32,f'missing feasible frame near {point.x}, {point.y}')

    def test_railway_river_crossings_receive_two_simple_side_trusses(self):
        import json
        env=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        deck=unary_union([Polygon(t) for t in env['railway']['deck']])
        water=unary_union([Polygon(t) for t in env['water']])
        crossings=deck.buffer(2,join_style=2).intersection(water)
        parts=list(crossings.geoms) if hasattr(crossings,'geoms') else [crossings]
        parts=[p for p in parts if p.area>=100]
        trusses=env['railway']['bridgeTrusses']
        self.assertEqual(len(trusses),len(parts))
        self.assertGreaterEqual(len(trusses),2)
        for truss in trusses:
            self.assertEqual(len(truss['sides']),2)
            self.assertTrue(2<=truss['panels']<=8)
            sides=[LineString(side) for side in truss['sides']]
            self.assertLess(abs(sides[0].length-sides[1].length),1e-6)
            middle=LineString([sides[0].interpolate(.5,normalized=True),sides[1].interpolate(.5,normalized=True)])
            self.assertGreater(middle.intersection(deck).length,2)
            self.assertGreater(middle.intersection(water).length,2)

    def test_standalone_rail_trusses_reach_both_upper_banks(self):
        # Unequal bank edges exercise the two chords independently.
        water=Polygon([(-35,-20),(25,-20),(35,20),(-25,20)])
        banks=Polygon([(-100,-100),(100,-100),(100,100),(-100,100)]).difference(water.buffer(7,join_style=3))
        deck=LineString([(-90,0),(90,0)]).buffer(5,cap_style=2)
        trusses=city.railway_bridge_trusses(deck,Polygon(),water,banks)
        self.assertEqual(len(trusses),1)
        self.assertTrue(trusses[0]['bankSupported'])
        for side in trusses[0]['sides']:
            for endpoint in side:
                self.assertTrue(banks.covers(Point(endpoint).buffer(.25)))

        import json
        env=json.loads((Path(__file__).resolve().parents[1]/'src/generated/chicago.json').read_text())['environment']
        water=unary_union([Polygon(t) for t in env['water']])
        lowered_banks=city.snap_outline(water.buffer(7,join_style=3))
        standalone=[t for t in env['railway']['bridgeTrusses'] if t['bankSupported']]
        self.assertTrue(standalone)
        for truss in standalone:
            for side in truss['sides']:
                for endpoint in side:
                    self.assertFalse(lowered_banks.intersects(Point(endpoint).buffer(.25)))
