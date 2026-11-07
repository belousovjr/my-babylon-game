"""Offline OSM → metric city, reusable architectural templates, and a reviewable SVG map.
Requires Shapely >=2.1. Coordinates: east +X, north +Z, one unit = one metre.
"""
import gzip
import json, math, re, glob, xml.etree.ElementTree as ET
from pathlib import Path
from collections import Counter, defaultdict
from shapely.geometry import Polygon, LineString, Point, box, MultiPolygon
from shapely.ops import unary_union, polygonize, linemerge, nearest_points
from shapely import constrained_delaunay_triangles, set_precision
from shapely.geometry.polygon import orient
from shapely.affinity import rotate, translate
from shapely.prepared import prep
from shapely.strtree import STRtree

ROOT=Path(__file__).resolve().parents[1]
LON,LAT=-87.63075,41.88425
BBOX=(-87.642,41.877,-87.6195,41.8915)
def project(lon,lat): return ((lon-LON)*111320*math.cos(math.radians(LAT)),(lat-LAT)*111320)
def rounded(v): return round(float(v),2)
def tags(e): return {t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
def number(s):
    m=re.search(r'[-+]?\d+(?:\.\d+)?',str(s or ''))
    return float(m.group()) if m else 0

def snap_outline(poly):
    # Snap source outlines once; keep intersections exact so neighbouring surfaces share vertices.
    return set_precision(set_precision(poly,0.01),0)

def triangles(poly):
    # Constrained triangulation preserves concave boundaries and holes without dropping faces.
    faces=constrained_delaunay_triangles(poly)
    assert abs(sum(t.area for t in faces.geoms)-poly.area)<max(1e-6,poly.area*1e-9), 'Incomplete surface triangulation'
    return [[[float(x),float(z)] for x,z in list(t.exterior.coords)[:3]] for t in faces.geoms]

def rings(poly):
    polygons=list(poly.geoms) if hasattr(poly,'geoms') else [poly]
    return [[[float(x),float(z)] for x,z in ring.coords]
            for p in polygons if p.geom_type=='Polygon' for q in [orient(p,sign=1)] for ring in [q.exterior,*q.interiors]]

def clean_roads(roads,bounds):
    lines=[LineString(r['points']) for r in roads]
    tree=STRtree(lines)
    joined=[]
    for i,line in enumerate(lines):
        points=list(line.coords)
        for end in [0,-1]:
            point=Point(points[end])
            neighbours=[lines[j] for j in tree.query(point.buffer(12)) if j!=i]
            if not neighbours:continue
            if any(other.distance(point)<=.01 for other in neighbours):continue
            previous=points[1] if end==0 else points[-2]
            vx,vz=point.x-previous[0],point.y-previous[1]
            targets=[]
            for other in neighbours:
                target=nearest_points(point,other)[1]
                distance=point.distance(target)
                forward=(target.x-point.x)*vx+(target.y-point.y)*vz
                if distance<=12 and forward>.1*distance*math.hypot(vx,vz):targets.append((distance,target))
            if targets:
                target=min(targets,key=lambda item:item[0])[1].coords[0]
                if end==0:points.insert(0,target)
                else:points.append(target)
        joined.append(LineString(points))
    network=unary_union(joined)
    merged=linemerge(network) if network.geom_type=='MultiLineString' else network
    paths=list(merged.geoms) if hasattr(merged,'geoms') else [merged]
    degrees=Counter(tuple(p) for line in paths for p in [line.coords[0],line.coords[-1]])
    keep=[]
    for line in paths:
        ends=[tuple(line.coords[0]),tuple(line.coords[-1])]
        leaf=any(degrees[p]==1 and bounds.boundary.distance(Point(p))>.5 for p in ends)
        direct=Point(ends[0]).distance(Point(ends[1]))
        redundant=direct<12 and line.length>2*direct
        if not (line.length<60 and (leaf or redundant)):keep.append(line)
    network=unary_union(keep)
    result=[]
    for road,line in zip(roads,joined):
        clipped=line.intersection(network)
        for part in (list(clipped.geoms) if hasattr(clipped,'geoms') else [clipped]):
            if part.geom_type=='LineString' and part.length>.01:
                result.append(dict(road,points=[list(p) for p in part.coords]))
    return result

def street_surfaces(roads,bounds):
    asphalt=unary_union([LineString(r['points']).simplify(0.3).buffer(r['width']/2,cap_style=2,join_style=3) for r in roads])
    # Close narrow notches with bevels instead of preserving pointed OSM leftovers.
    asphalt=asphalt.buffer(1.2,quad_segs=1,join_style=3).buffer(-1.2,quad_segs=1,join_style=3)
    asphalt=snap_outline(asphalt.simplify(0.6).intersection(bounds))
    polygons=list(asphalt.geoms) if hasattr(asphalt,'geoms') else [asphalt]
    asphalt=max(polygons,key=lambda p:p.area)
    # Tiny enclosed holes become asphalt, not miniature pedestrian islands.
    asphalt=Polygon(asphalt.exterior,[ring for ring in asphalt.interiors if Polygon(ring).area>=64])
    pavement=snap_outline(asphalt.buffer(3.2,join_style=3).intersection(bounds))
    return asphalt,pavement.difference(asphalt),pavement

def elevated_metro(t):
    return (t.get('railway')=='subway' and t.get('operator')=='Chicago Transit Authority'
            and number(t.get('layer'))>0 and t.get('tunnel')!='yes' and not t.get('service'))

def railway_geometry(lines,bounds,water):
    tracks=unary_union(lines)
    if tracks.is_empty:return dict(deck=[],edges=[],rails=[],railEdges=[],supports=[])
    # Merge before clipping; short way fragments and shared endpoints are part of the same route.
    tracks=linemerge(tracks) if tracks.geom_type=='MultiLineString' else tracks
    paths=list(tracks.geoms) if hasattr(tracks,'geoms') else [tracks]
    deck=unary_union([line.buffer(2.1,cap_style=2,join_style=2,mitre_limit=2) for line in paths]).intersection(bounds)
    rails=unary_union([line.offset_curve(side,join_style=2,mitre_limit=2).buffer(.045,cap_style=2,join_style=2) for line in paths for side in [-.72,.72]]).intersection(bounds)
    supports=[]
    unsupported_water=water.buffer(1)
    for ring in rings(deck):
        edge=LineString(ring)
        for distance in range(4,int(edge.length),4):
            point=edge.interpolate(distance)
            if not unsupported_water.covers(point): supports.append([point.x,point.y])
    return dict(deck=triangles(deck),edges=rings(deck),rails=triangles(rails),railEdges=rings(rails),supports=supports)

def railway_bridge_trusses(deck,pavement,water,banks):
    crossings=deck.buffer(2,join_style=2).intersection(water)
    polygons=list(crossings.geoms) if hasattr(crossings,'geoms') else [crossings]
    result=[]
    for polygon in polygons:
        if polygon.area<100:continue
        rectangle=polygon.minimum_rotated_rectangle
        corners=list(rectangle.exterior.coords)
        a,b=max(zip(corners,corners[1:]),key=lambda edge:math.dist(*edge))
        length=math.dist(a,b);ux,uz=(b[0]-a[0])/length,(b[1]-a[1])/length
        nx,nz=-uz,ux;mid=rectangle.centroid
        section=LineString([(mid.x-nx*30,mid.y-nz*30),(mid.x+nx*30,mid.y+nz*30)]).intersection(pavement)
        spans=list(section.geoms) if hasattr(section,'geoms') else [section]
        spans=[line for line in spans if line.geom_type=='LineString' and line.distance(mid)<.01]
        if spans:
            span=max(spans,key=lambda line:line.length);centre=span.centroid;width=span.length-1
        else:
            centre=mid;width=min(math.dist(a,b) for a,b in zip(corners,corners[1:]))-3.6
        if width<4:continue
        distances=[-length/2-2,length/2+2]
        bank_supported=not spans
        if bank_supported:
            safe_banks=prep(banks.buffer(-.3))
            # Both chords must reach the upper bank, beyond the lowered riverwalk.
            for end,direction in enumerate([-1,1]):
                for step in range(513):
                    distance=distances[end]+direction*step*.5
                    if all(safe_banks.covers(Point(centre.x+nx*sign*width/2+ux*distance,centre.y+nz*sign*width/2+uz*distance)) for sign in [-1,1]):
                        distances[end]=distance
                        break
                else:raise ValueError('Railway truss cannot reach solid banks within 256 m')
        sides=[[[centre.x+nx*sign*width/2+ux*distance,centre.y+nz*sign*width/2+uz*distance] for distance in distances] for sign in [-1,1]]
        result.append(dict(sides=sides,bankSupported=bank_supported,panels=max(2,min(8,math.ceil((distances[1]-distances[0])/12)))))
    return result

def street_lamps(roads,sidewalks,asphalt):
    safe=sidewalks.buffer(-.25)
    if safe.is_empty:return []
    lamps=[]
    for road in roads:
        if road['bridge']:continue
        for a,b in zip(road['points'],road['points'][1:]):
            dx,dz=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dz)
            if length<=45:continue
            nx,nz=-dz/length,dx/length
            for distance in range(25,int(length-20),85):
                side=road['width']/2+.6
                desired=Point(a[0]+dx*distance/length+nx*side,a[1]+dz*distance/length+nz*side)
                point=nearest_points(desired,safe)[1]
                if desired.distance(point)>4 or point.distance(asphalt)>1.2:continue
                if any(point.distance(Point(lamp['position'][0],lamp['position'][2]))<8 for lamp in lamps):continue
                road_edge=nearest_points(point,asphalt)[1]
                lamps.append(dict(templateId='lamp',position=[point.x,.16,point.y],yaw=-math.atan2(road_edge.y-point.y,road_edge.x-point.x)))
    return lamps

def road_arms(origin,roads,lines,tree):
    arms=[]
    for index in tree.query(origin.buffer(.1)):
        index=int(index);line=lines[index];road=roads[index]
        if line.distance(origin)>.1:continue
        distance=line.project(origin)
        for sign in [-1,1]:
            sample=line.interpolate(max(0,min(line.length,distance+sign*8)))
            dx,dz=sample.x-origin.x,sample.y-origin.y;length=math.hypot(dx,dz)
            if length<1:continue
            direction=[dx/length,dz/length];one=road.get('oneway','no')
            incoming=one not in ['yes','1','true','-1'] or (sign<0 if one!='-1' else sign>0)
            previous=next((a for a in arms if sum(x*y for x,y in zip(a['direction'],direction))>.98),None)
            if previous:
                previous['width']=max(previous['width'],road['width']);previous['incoming']|=incoming
                previous['twoWay']|=one not in ['yes','1','true','-1']
            else:arms.append(dict(direction=direction,width=road['width'],incoming=incoming,twoWay=one not in ['yes','1','true','-1']))
    return arms

def traffic_signals(roads,sidewalks,asphalt):
    roads=[r for r in roads if r.get('highway') in ['primary','secondary','trunk','tertiary']]
    if not roads:return []
    lines=[LineString(r['points']) for r in roads]
    network=unary_union(lines)
    parts=list(network.geoms) if hasattr(network,'geoms') else [network]
    junctions=defaultdict(list)
    for line in parts:
        if line.geom_type!='LineString' or line.length<2:continue
        for reverse in [False,True]:
            path=LineString(list(line.coords)[::-1]) if reverse else line
            origin=Point(path.coords[0]);sample=path.interpolate(min(8,path.length))
            dx,dz=sample.x-origin.x,sample.y-origin.y;length=math.hypot(dx,dz)
            junctions[origin.coords[0]].append((dx/length,dz/length))
    safe=sidewalks.buffer(-.3).difference(asphalt.buffer(.65))
    if safe.is_empty:return []
    signals=[];centres=[];tree=STRtree(lines)
    for node,branches in sorted(junctions.items(),key=lambda item:(-len(item[1]),item[0])):
        if len(branches)!=4:continue
        origin=Point(node)
        if any(origin.distance(previous)<8 for previous in centres):continue
        if not any(roads[int(i)]['highway'] in ['primary','secondary','trunk'] and lines[int(i)].distance(origin)<.1 for i in tree.query(origin.buffer(.1))):continue
        arms=road_arms(origin,roads,lines,tree)
        approaches=[(*arm['direction'],arm['width']) for arm in arms if arm['incoming']]
        if len(approaches)<2:continue
        width=max(roads[int(i)]['width'] for i in tree.query(origin.buffer(.1)) if lines[int(i)].distance(origin)<.1)
        placed=[]
        for ux,uz,approach_width in approaches:
            if placed:
                ax,az=placed[0]['approach']
                if abs(ax*ux+az*uz)>.7:continue
            corners=[Point(node[0]-ux*(width/2+.65)-uz*side*(approach_width/2+.65),
                           node[1]-uz*(width/2+.65)+ux*side*(approach_width/2+.65)) for side in [1,-1]]
            if placed:
                previous=Point(placed[0]['position'][0],placed[0]['position'][2])
                corners.sort(key=lambda point:point.distance(previous),reverse=True)
            for desired in corners:
                point=nearest_points(desired,safe)[1]
                if placed and point.distance(previous)<5:continue
                if desired.distance(point)>3 or not .6<=point.distance(asphalt)<=2.5:continue
                if any(point.distance(Point(s['position'][0],s['position'][2]))<.8 for s in signals+placed):continue
                placed.append(dict(templateId='traffic_signal',position=[point.x,.16,point.y],
                                 yaw=math.atan2(ux,uz),junction=list(node),approach=[ux,uz],headings=[0],approaches=[[ux,uz]]))
                break
            if len(placed)==2:break
        if len(placed)==2:
            for ux,uz,_ in approaches:
                if any(any(ux*a+uz*b>.995 for a,b in signal['approaches']) for signal in placed):continue
                signal=min(placed,key=lambda signal:(signal['position'][0]-node[0])*ux+(signal['position'][2]-node[1])*uz)
                angle=math.atan2(ux,uz)-signal['yaw']
                angle=math.atan2(math.sin(angle),math.cos(angle))
                angle=round(angle/(math.pi/12))*(math.pi/12)
                if angle not in signal['headings']:signal['headings'].append(angle)
                signal['approaches'].append([ux,uz])
            signals.extend(placed);centres.append(origin)
    return signals

def pedestrian_crossings(signals,roads,sidewalks,asphalt):
    result=[]
    paint_area=asphalt.buffer(-.08)
    lines=[LineString(r['points']) for r in roads];tree=STRtree(lines)
    junctions=sorted({tuple(signal['junction']) for signal in signals})
    for junction in junctions:
      arms=road_arms(Point(junction),roads,lines,tree)
      for arm in arms:
        ux,uz=arm['direction'];nx,nz=-uz,ux;jx,jz=junction;depth=3
        # Adjacent carriageway nodes share the median link, not an extra crossing across it.
        if any(0<(other[0]-jx)*ux+(other[1]-jz)*uz<50 and abs(-(other[0]-jx)*uz+(other[1]-jz)*ux)<2
               and asphalt.covers(LineString([junction,other])) for other in junctions if other!=junction):continue
        perpendicular=[a['width'] for a in arms if abs(sum(x*y for x,y in zip(a['direction'],arm['direction'])))<.7]
        if not perpendicular:continue
        # Leave the corner apex for poles; crosswalks follow the sidewalk routes around it.
        start=max(perpendicular)/2+1+depth/2
        for extra in [0,.5,1,1.5,2]:
            cx,cz=jx+ux*(start+extra),jz+uz*(start+extra)
            section=LineString([(cx-nx*40,cz-nz*40),(cx+nx*40,cz+nz*40)]).intersection(asphalt)
            spans=list(section.geoms) if hasattr(section,'geoms') else [section]
            spans=[line for line in spans if line.geom_type=='LineString' and line.distance(Point(cx,cz))<.01]
            if not spans:continue
            span=min(spans,key=lambda line:line.distance(Point(cx,cz)))
            if not 5<=span.length<=min(32,arm['width']*1.3):continue
            a,b=Point(span.coords[0]),Point(span.coords[-1])
            if any(sidewalks.distance(point)>.5 for point in [a,b]):continue
            centre=span.interpolate(.5,normalized=True);width=span.length
            def rectangle(offset,half_width,half_depth):
                return Polygon([(centre.x+nx*(offset+side*half_width)+ux*end*half_depth,centre.y+nz*(offset+side*half_width)+uz*end*half_depth) for side,end in [(-1,-1),(1,-1),(1,1),(-1,1)]])
            corridor=rectangle(0,width/2,depth/2)
            if corridor.intersection(asphalt).area<corridor.area*.98:continue
            walkway=rectangle(0,width/2+1.2,depth/2)
            if any(walkway.distance(Point(signal['position'][0],signal['position'][2]))<.2 for signal in signals):continue
            count=math.floor((width-.4)/1.2)
            stripes=[tri for i in range(count) for tri in triangles(rectangle((i-(count-1)/2)*1.2,.3,depth/2).intersection(paint_area))]
            stop=[]
            stop_centre=None
            if arm['incoming']:
                # A 1.3 m clear gap exceeds the usual 4 ft between crosswalk and stop bar.
                sx,sz=centre.x+ux*(depth/2+1.5),centre.y+uz*(depth/2+1.5)
                lane_width=width/2 if arm['twoWay'] else width
                lateral=width/4 if arm['twoWay'] else 0
                stop_centre=[sx+nx*lateral,sz+nz*lateral]
                bar=Polygon([(stop_centre[0]+nx*side*(lane_width/2-.1)+ux*end*.2,stop_centre[1]+nz*side*(lane_width/2-.1)+uz*end*.2) for side,end in [(-1,-1),(1,-1),(1,1),(-1,1)]])
                stop=triangles(bar.intersection(paint_area))
            if stripes:
                result.append(dict(centre=[centre.x,centre.y],direction=[ux,uz],width=width,depth=depth,junction=list(junction),stripes=stripes,stopLine=stop,stopCentre=stop_centre))
                break
    return result

def railway_support_candidates(points,sidewalks,asphalt,lowered_banks,deck,ground):
    allowed=sidewalks.buffer(-.5).union(ground.buffer(-.5)).difference(lowered_banks.buffer(.5))
    if allowed.is_empty:return []
    allowed=allowed.difference(deck.buffer(.55))
    edges=[LineString(ring) for ring in rings(deck)]
    for x,z in points:
        origin=Point(x,z)
        edge=min(edges,key=lambda line:line.distance(origin));distance=edge.project(origin)
        a=edge.interpolate((distance-.5)%edge.length);b=edge.interpolate((distance+.5)%edge.length)
        dx,dz=b.x-a.x,b.y-a.y;length=math.hypot(dx,dz)
        if length<.01:continue
        normal=math.atan2(dx,-dz)
        for angle in [0,5,-5,10,-10]:
            nx,nz=math.cos(normal+math.radians(angle)),math.sin(normal+math.radians(angle))
            cross=LineString([(x-nx*40,z-nz*40),(x+nx*40,z+nz*40)]).intersection(deck)
            spans=list(cross.geoms) if hasattr(cross,'geoms') else [cross]
            spans=[line for line in spans if line.geom_type=='LineString' and line.length>2]
            if not spans:continue
            span=min(spans,key=lambda line:line.distance(origin))
            # Join nearby parallel tracks into one frame, without filling the deck gap.
            for neighbour in sorted(spans,key=lambda line:line.distance(span)):
                if neighbour==span or span.distance(neighbour)>4:continue
                mid=neighbour.interpolate(.5,normalized=True)
                if not all(deck.covers(Point(mid.x-nz*offset,mid.y+nx*offset)) for offset in [-6,6]):continue
                endpoints=[Point(p) for line in [span,neighbour] for p in [line.coords[0],line.coords[-1]]]
                endpoints.sort(key=lambda p:p.x*nx+p.y*nz)
                joined=LineString([endpoints[0],endpoints[-1]])
                if joined.length<=14:span=joined
            a,b=Point(span.coords[0]),Point(span.coords[-1])
            ux,uz=(b.x-a.x)/span.length,(b.y-a.y)/span.length
            pair=[]
            for point,sign in [(a,-1),(b,1)]:
                candidates=allowed.intersection(LineString([(point.x+ux*.55*sign,point.y+uz*.55*sign),(point.x+ux*4*sign,point.y+uz*4*sign)]))
                if candidates.is_empty:break
                foot=nearest_points(point,candidates)[1]
                pair.append(dict(position=[foot.x,.16 if sidewalks.covers(foot) else 0,foot.y],top=6.05,attachment=[point.x,point.y],skew=angle))
            if len(pair)!=2:continue
            pa,pb=pair[0]['position'],pair[1]['position']
            spacing=math.hypot(pa[0]-pb[0],pa[2]-pb[2])
            if spacing<max(2,span.length*.6) or max(span.length,spacing)>14:continue
            yield pair
            break

def place_railway_supports(points,sidewalks,asphalt,lowered_banks,deck,ground):
    supports=[];centres=[]
    for pair in railway_support_candidates(points,sidewalks,asphalt,lowered_banks,deck,ground):
        a,b=pair[0]['position'],pair[1]['position']
        centre=Point((a[0]+b[0])/2,(a[2]+b[2])/2)
        if any(centre.distance(previous)<20 for previous in centres):continue
        centres.append(centre);supports.extend(pair)
    return supports


def building_footprint(o):
    w,_,d=o['size'];x,_,z=o['position']
    # Include the largest architectural trim (1.03 times the collision footprint).
    return translate(rotate(box(-w*.515,-d*.515,w*.515,d*.515),-o['yaw'],origin=(0,0),use_radians=True),x,z)

def fit_building(o,land):
    original=building_footprint(o)
    if land.covers(original):return o
    space=land.intersection(original)
    polygons=list(space.geoms) if hasattr(space,'geoms') else [space]
    polygons=[p for p in polygons if p.geom_type=='Polygon' and p.area>=25]
    if not polygons:return None
    parcel=max(polygons,key=lambda p:p.area)
    points=[parcel.centroid,parcel.representative_point()]
    centres=[(o['position'][0],o['position'][2]),*[(round(p.x),round(p.y)) for p in points]]
    w,h,d=o['size']
    sizes={(math.floor(w*a/20*4)/4,math.floor(d*b/20*4)/4) for a in range(7,21) for b in range(7,21)}
    for width,depth in sorted(sizes,key=lambda size:(size[0]*size[1],size),reverse=True):
        if min(width,depth)<5 or width*depth<w*d*.25:continue
        for x,z in centres:
            fitted=dict(o,position=[x,h/2,z],size=[width,h,depth])
            if space.covers(building_footprint(fitted)):return fitted
    return None

def fit_landmark_group(objects,land,identical=False):
    # Preserve composition: one translation and one horizontal scale for the whole group.
    allowed=prep(land)
    offsets=sorted(((x,z) for x in range(-32,33) for z in range(-32,33)),key=lambda p:(p[0]**2+p[1]**2,p))
    if identical:
        diameter=math.floor(min(min(o['size'][0],o['size'][2]) for o in objects)*4)/4
        objects=[dict(o,size=[diameter,max(v['size'][1] for v in objects),diameter],yaw=0) for o in objects]
    for step in range(20,9,-1):
        candidates=[dict(o,size=[math.floor(o['size'][0]*step/20*4)/4,o['size'][1],math.floor(o['size'][2]*step/20*4)/4]) for o in objects]
        footprint=unary_union([building_footprint(o) for o in candidates])
        for dx,dz in offsets:
            if allowed.covers(translate(footprint,dx,dz)):
                return [dict(o,position=[o['position'][0]+dx,o['size'][1]/2,o['position'][2]+dz]) for o in candidates]
    raise RuntimeError('Cannot preserve landmark group within 32 m: '+', '.join(o['id'] for o in objects))

def unsupported_elevated_building(t):
    # Layer is ordering, not metres: do not invent ground-level towers for untyped elevated structures.
    return (number(t.get('layer'))>0 and t.get('building')=='yes'
            and not t.get('name') and not number(t.get('height')) and not number(t.get('building:levels')))

def main():
    nodes,ways,relations={},{},{}
    files=glob.glob(str(ROOT/'data/chicago/osm-*.xml'))+glob.glob(str(ROOT/'data/chicago/river-*.xml'))
    snapshot=ROOT/'data/chicago/osm-snapshot.xml.gz'
    if snapshot.exists(): files=[snapshot]
    if not files: raise RuntimeError('Run scripts/fetch-chicago.py first')
    for path in files:
        opener=gzip.open if str(path).endswith('.gz') else open
        with opener(path,'rb') as stream: elements=ET.parse(stream).getroot()
        for e in elements:
            if e.tag=='node': nodes[e.attrib['id']]=project(float(e.attrib['lon']),float(e.attrib['lat']))
            elif e.tag=='way': ways[e.attrib['id']]=(tags(e),[n.attrib['ref'] for n in e.findall('nd')])
            elif e.tag=='relation': relations[e.attrib['id']]=(tags(e),[(n.attrib['ref'],n.attrib.get('role','')) for n in e.findall('member') if n.attrib['type']=='way'])
    def coords(refs): return [nodes[n] for n in refs if n in nodes]
    def polygon(refs):
        c=coords(refs)
        if len(c)<4 or c[0]!=c[-1]: return Polygon()
        return Polygon(c).buffer(0)
    bounds=snap_outline(box(*project(BBOX[0],BBOX[1]),*project(BBOX[2],BBOX[3])))
    # Only rivers receive lowered terraces; small pools and fountains are omitted.
    water=[]; relation_buildings=[]; outer_buildings=set()
    for rid,(t,members) in relations.items():
        if (t.get('natural')=='water' and t.get('water')=='river') or t.get('building'):
            lines=[LineString(coords(ways[ref][1])) for ref,role in members if role!='inner' and ref in ways and len(coords(ways[ref][1]))>=2]
            polygons=list(polygonize(unary_union(lines))) if lines else []
            for p in polygons:
                p=p.intersection(bounds)
                if p.is_empty: continue
                if t.get('natural')=='water' and t.get('water')=='river': water.append(p)
                elif t.get('building'):
                    relation_buildings.append((f'r{rid}',t,p));outer_buildings.update(ref for ref,_ in members)
    for wid,(t,refs) in ways.items():
        if t.get('natural')=='water' and t.get('water')=='river':
            p=polygon(refs).intersection(bounds)
            if not p.is_empty:water.append(p)
    water=unary_union(water).buffer(0)
    assert water.area>10000,'Missing river geometry'
    parts=[]; buildings=relation_buildings[:]; roads=[]; parks=[]; rails=[]
    for wid,(t,refs) in ways.items():
        if 'building:part' in t:
            p=polygon(refs)
            if not p.is_empty: parts.append((p,number(t.get('height')) or number(t.get('building:levels'))*3.6))
        if t.get('building') and t['building'] not in ['roof','construction','garage','shed','service'] and wid not in outer_buildings:
            p=polygon(refs).intersection(bounds)
            if p.area>90: buildings.append((f'w{wid}',t,p))
        if t.get('leisure')=='park':
            p=polygon(refs).intersection(bounds)
            if p.area>200: parks.append(p)
        if elevated_metro(t):
            c=coords(refs)
            if len(c)>1:rails.append(LineString(c))
        if t.get('highway') in ['primary','secondary','tertiary','residential','unclassified','trunk','primary_link','secondary_link','tertiary_link','trunk_link'] and t.get('tunnel')!='yes' and number(t.get('layer'))>=0:
            c=coords(refs)
            if len(c)<2:continue
            line=LineString(c).intersection(bounds)
            lines=list(line.geoms) if hasattr(line,'geoms') else [line]
            for line in lines:
                if line.geom_type!='LineString' or line.length<.01:continue
                width=number(t.get('width')) or max(9,min(26,(number(t.get('lanes')) or (3 if t['highway'] in ['primary','secondary'] else 2))*3.2))
                roads.append({'id':f'osm-{wid}','name':t.get('name',''),'highway':t['highway'],'oneway':t.get('oneway','no'),'width':rounded(width),'bridge':t.get('bridge') in ['yes','movable'] or line.intersects(water),'points':[[rounded(x),rounded(z)] for x,z in line.simplify(1).coords]})
    railway=railway_geometry(rails,bounds,water)
    roads=clean_roads(roads,bounds)
    road_union,sidewalks,pavement=street_surfaces(roads,bounds)
    road_cover=prep(road_union.buffer(.05))
    roads=[r for r in roads if road_cover.covers(LineString(r['points']))]
    pavement=pavement.union(road_union)
    sidewalks=pavement.difference(road_union)
    water=snap_outline(water.simplify(0.5,preserve_topology=True))
    river_buffer=snap_outline(water.buffer(7,join_style=3))
    exposed_ground=bounds.difference(river_buffer).difference(pavement)
    rail_deck=unary_union([Polygon(t) for t in railway['deck']])
    railway['bridgeTrusses']=railway_bridge_trusses(rail_deck,pavement,water,bounds.difference(river_buffer))
    railway['supports']=place_railway_supports(railway['supports'],sidewalks,road_union,river_buffer,rail_deck,exposed_ground)
    rail_clearance=rail_deck.buffer(1.5)
    rail_clearance=rail_clearance.union(unary_union([LineString([(s['position'][0],s['position'][2]),s['attachment']]).buffer(.5) for s in railway['supports']]))
    building_land=exposed_ground.difference(rail_clearance)
    fitted_count=skipped_count=0
    specs=[
      ('glass','Стеклянная офисная башня',[32,100,32],'#759ca8',[180,650]),
      ('stone','Чикагская школа · каменный корпус',[36,55,30],'#b8ac91',[130,500]),
      ('deco','Ар-деко · ступенчатая башня',[36,140,32],'#b9b29f',[180,700]),
      ('bundled','Willis · пучок труб',[70,442,70],'#424d56',[250,1000]),
      ('rounded','Trump · округлая башня',[58,423,60],'#9cb6bd',[220,900]),
      ('marina','Marina City · круглая башня',[38,179,38],'#c6c0a9',[180,650]),
      ('gothic','Tribune · готическая корона',[45,141,40],'#baa992',[180,650]),
      ('clock','Wrigley · светлая часовая башня',[50,134,40],'#ded9bf',[180,650]),
      ('tree','Уличное дерево',[5,8,5],'#648263',[90]),
      ('traffic_signal','Уличный светофор',[.7,4.5,.7],'#e0ded3',[100]),
      ('lamp','Чикагский фонарь',[1,8,1],'#414c4c',[100]),
    ]
    templates=[dict(id=p,name=n,kind='building' if p not in ['tree','lamp','traffic_signal'] else 'obstacle',size=s,color=c,profile=p,lodDistances=d) for p,n,s,c,d in specs]
    objects=[]; source=[]; heights=Counter(); families=Counter(); seen_ids=Counter()
    records=[]
    for wid,t,p in buildings:
        if unsupported_elevated_building(t):continue
        if p.geom_type=='MultiPolygon':p=max(p.geoms,key=lambda v:v.area)
        if p.area<90:continue
        center=p.centroid
        if not bounds.contains(center) or water.contains(center):continue
        rect=p.minimum_rotated_rectangle
        c=list(rect.exterior.coords);v=(c[1][0]-c[0][0],c[1][1]-c[0][1]);w=math.hypot(*v);d=math.dist(c[1],c[2]);yaw=-math.atan2(v[1],v[0]);yaw=(yaw+math.pi)%(2*math.pi)-math.pi
        if min(w,d)<5 or max(w,d)>500:continue
        name=t.get('name','');low=name.lower()
        tagged=number(t.get('height'))
        if 'ft' in t.get('height','') or "'" in t.get('height',''):tagged*=0.3048
        partheight=max([h for poly,h in parts if h and p.intersection(poly).area>min(p.area,poly.area)*0.6]+[0])
        h=max(tagged,partheight)
        method='osm-height' if h else 'osm-levels' if number(t.get('building:levels')) else 'estimated'
        h=h or number(t.get('building:levels'))*3.6 or (24 if p.area<600 else 55)
        year=number(t.get('start_date'))
        profile='deco' if 1900<year<1945 and h>75 else 'stone' if (year and year<1950) or h<65 else 'glass'
        for match,family,height in [('willis tower','bundled',442),('trump international','rounded',423),('tribune tower','gothic',141),('wrigley building','clock',134),('marina city 1','marina',179),('marina city 2','marina',179)]:
            if match in low:profile=family;h=height;method='landmark-reference'
        if profile=='clock' and 70<partheight<130: h=partheight
        h=max(6,min(600,h))
        seen_ids[wid]+=1
        unique_id=wid if seen_ids[wid]==1 else f'{wid}-{seen_ids[wid]}'
        # Snap the footprint anchor; the vertical centre follows half-height to keep the base at zero.
        w,d,h=[round(value*4)/4 for value in [w,d,h]]
        yaw=round(yaw/(math.pi/12))*(math.pi/12)
        o=dict(id=f'osm-{unique_id}',templateId=profile,name=name or t.get('addr:street','Chicago building'),position=[round(rect.centroid.x),h/2,round(rect.centroid.y)],size=[w,h,d],yaw=yaw)
        records.append(dict(object=o,protected=method=='landmark-reference' or profile=='deco' or h>=150,method=method,
                            source=dict(id=wid,name=name,height=rounded(h),heightSource=method,profile=profile,footprint=[[rounded(x),rounded(z)] for x,z in p.exterior.coords])))
    groups=defaultdict(list)
    for record in records:
        o=record['object']
        if record['protected']:
            # Repeated Marina profiles form an identical ensemble; other landmarks retain their own proportions.
            key=('identical',o['templateId']) if o['templateId']=='marina' else ('single',o['id'])
            groups[key].append(record)
    protected_ids=[]
    for key,group in sorted(groups.items(),key=lambda pair:(pair[0][0]!='identical',pair[0])):
        fitted=fit_landmark_group([r['object'] for r in group],building_land,key[0]=='identical')
        for record,o in zip(group,fitted):
            record['fitted']=o
            protected_ids.append(o['id'])
        building_land=building_land.difference(unary_union([building_footprint(o).buffer(0.5) for o in fitted]))
    for record in records:
        original=record['object']
        o=record.get('fitted') if record['protected'] else fit_building(original,building_land)
        if o is None:
            skipped_count+=1
            continue
        if o!=original:fitted_count+=1
        assert exposed_ground.covers(building_footprint(o)), f"Unsupported building: {o['id']}"
        families[o['templateId']]+=1;heights[record['method']]+=1
        objects.append(o);source.append(record['source'])
    # Carry the structural slab across the lowered bank terrace and into solid ground.
    bridge=pavement.intersection(river_buffer.buffer(2,join_style=3))
    abutments=pavement.intersection(water.buffer(2,join_style=3).difference(water))
    bridge_rails=bridge.boundary.intersection(river_buffer.buffer(-0.5))
    rail_lines=list(bridge_rails.geoms) if hasattr(bridge_rails,'geoms') else [bridge_rails]

    # No almost-coplanar ground beneath paving: it flickers through at overview distances.
    assert exposed_ground.intersection(pavement).area<1e-6
    # Triangulate first, then batch: cutting polygons at cell borders introduces extra seam vertices.
    terrain_cells=defaultdict(list)
    for tri in triangles(exposed_ground):
        cell=tuple(math.floor(sum(p[i] for p in tri)/3/256)*256 for i in [0,1])
        terrain_cells[cell].append(tri)
    terrain=[dict(cell=list(cell),triangles=tris) for cell,tris in sorted(terrain_cells.items())]
    # Riverwalk is an explicitly stylized lower terrace, not a surveyed elevation model.
    riverwalk=river_buffer.difference(water).intersection(bounds)
    # A usable spawn on State Street, south of the river, outside building bounds.
    spawn=project(-87.6278,41.8865)
    world=dict(version=3,environment='chicago-loop',spawn=[round(spawn[0]),1,round(spawn[1])],templates=templates,objects=objects)
    curbs=snap_outline(road_union.buffer(0.22,join_style=3)).difference(road_union).intersection(sidewalks)
    sidewalks=sidewalks.difference(curbs)
    paving_edges=[dict(top=height,color=color,lines=rings(poly)) for poly,height,color in [(road_union,0.03,'#454e50'),(sidewalks,0.16,'#b6b2a4'),(curbs,0.18,'#c0bba9')]]
    assert bounds.difference(unary_union([exposed_ground,road_union,sidewalks,curbs,water,riverwalk])).area<1e-6, 'Uncovered terrain seam'
    terrace_lines=rings(river_buffer.intersection(bounds))
    ramps=[]
    for p in (list(water.geoms) if hasattr(water,'geoms') else [water]):
      if p.geom_type!='Polygon':continue
      c=list(p.exterior.simplify(3).coords)
      for a,b in zip(c,c[1:]):
        dx,dz=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dz)
        if length<70 or len(ramps)>=4:continue
        mx,mz=(a[0]+b[0])/2,(a[1]+b[1])/2
        if not (-700<mx<700 and 200<mz<600):continue
        nx,nz=-dz/length,dx/length
        if water.contains(Point(mx+nx*2,mz+nz*2)):nx,nz=-nx,-nz
        ramps.append({'top':[rounded(mx+nx*8),0.17,rounded(mz+nz*8)],'bottom':[rounded(mx+dx/length*32+nx*3),-3.78,rounded(mz+dz/length*32+nz*3)]})
    signals=traffic_signals(roads,sidewalks,road_union)
    lamps=[lamp for lamp in street_lamps(roads,sidewalks,road_union) if all(math.dist(lamp['position'],signal['position'])>1.5 for signal in signals)]
    env=dict(crosswalks=pedestrian_crossings(signals,roads,sidewalks,road_union),trafficSignals=signals,lamps=lamps,railway=railway,roadSurface=triangles(road_union),sidewalks=triangles(sidewalks),curbs=triangles(curbs),pavingEdges=paving_edges,terraceWalls=terrace_lines,ramps=ramps,origin=[LON,LAT],bounds=list(map(rounded,bounds.bounds)),roads=roads,terrain=terrain,water=triangles(water),riverwalk=triangles(riverwalk),parks=[tri for p in parks for tri in triangles(p.intersection(exposed_ground))],shorelines=rings(water),bridgeDeck=triangles(bridge),bridgeEdges=rings(bridge),bridgeAbutments=rings(abutments),bridgeRails=[[[float(x),float(z)] for x,z in line.coords] for line in rail_lines if line.geom_type=='LineString' and line.length>1])
    output=dict(world=world,environment=env,report=dict(buildings=len(objects),protectedBuildings=protected_ids,fittedBuildings=fitted_count,omittedBuildings=skipped_count,roads=len(roads),families=dict(families),heights=dict(heights),bounds=BBOX,origin=[LON,LAT],licence='ODbL-1.0',attribution='© OpenStreetMap contributors',waterArea=rounded(water.area)))
    assert len({o['id'] for o in objects})==len(objects), 'Duplicate OSM building IDs'
    (ROOT/'src/generated').mkdir(exist_ok=True)
    (ROOT/'src/generated/chicago.json').write_text(json.dumps(output,separators=(',',':'))+'\n')
    (ROOT/'data/chicago/buildings.json').write_text(json.dumps(source,separators=(',',':'))+'\n')
    (ROOT/'data/chicago/report.json').write_text(json.dumps(output['report'],indent=2)+'\n')
    minx,minz,maxx,maxz=env['bounds']; svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{minx} {-maxz} {maxx-minx} {maxz-minz}"><rect x="{minx}" y="{-maxz}" width="{maxx-minx}" height="{maxz-minz}" fill="#e5e1d5"/>']
    for tri in env['water']:svg.append('<polygon fill="#80afbb" points="'+' '.join(f'{x},{-z}' for x,z in tri)+'"/>')
    for r in roads:svg.append('<polyline fill="none" stroke="#fff" stroke-width="'+str(r['width'])+'" points="'+' '.join(f'{x},{-z}' for x,z in r['points'])+'"/>')
    for b in source:svg.append('<polygon fill="#8b9492" stroke="#45585c" stroke-width="1" points="'+' '.join(f'{x},{-z}' for x,z in b['footprint'])+'"><title>'+b['name'].replace('&','&amp;').replace('<','&lt;')+'</title></polygon>')
    for b in source:
        if b['profile'] in ['bundled','rounded','marina','gothic','clock']:
            cx=sum(p[0] for p in b['footprint'])/len(b['footprint']);cz=sum(p[1] for p in b['footprint'])/len(b['footprint'])
            svg.append(f'<text x="{cx}" y="{-cz}" font-size="11" fill="#182d32" stroke="#fff" stroke-width="2" paint-order="stroke">'+b['name'].replace('&','&amp;').replace('<','&lt;')+'</text>')
    svg.append(f'<path d="M {minx+25} {-minz-50} h 200 m -200 -5 v 10 m 200 -10 v 10" fill="none" stroke="#213b40" stroke-width="2"/>')
    svg.append(f'<circle cx="{spawn[0]}" cy="{-spawn[1]}" r="8" fill="#cf5936"/><text x="{minx+25}" y="{-maxz+35}" font-size="20">CHICAGO LOOP · 1 unit = 1 m · N ↑</text><text x="{minx+25}" y="{-minz-20}" font-size="14">© OpenStreetMap contributors · ODbL · 200 m</text></svg>')
    (ROOT/'public/maps/chicago.svg').write_text(''.join(svg))
    assert len(objects)>100 and len(roads)>100 and any(o['templateId']=='bundled' for o in objects)
    print(json.dumps(output['report'],indent=2))
if __name__=='__main__':main()
