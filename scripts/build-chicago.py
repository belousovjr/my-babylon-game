"""Offline OSM → metric city, reusable architectural templates, and a reviewable SVG map.
Requires Shapely >=2.1. Coordinates: east +X, north +Z, one unit = one metre.
"""
import gzip
import json, math, re, glob, xml.etree.ElementTree as ET
from pathlib import Path
from collections import Counter
from shapely.geometry import Polygon, LineString, Point, box, MultiPolygon
from shapely.ops import unary_union, polygonize
from shapely import constrained_delaunay_triangles, set_precision
from shapely.geometry.polygon import orient

ROOT=Path(__file__).resolve().parents[1]
LON,LAT=-87.63075,41.88425
BBOX=(-87.642,41.877,-87.6195,41.8915)
def project(lon,lat): return ((lon-LON)*111320*math.cos(math.radians(LAT)),(lat-LAT)*111320)
def rounded(v): return round(float(v),2)
def tags(e): return {t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
def number(s):
    m=re.search(r'[-+]?\d+(?:\.\d+)?',str(s or ''))
    return float(m.group()) if m else 0

def triangles(poly):
    # Constrained triangulation preserves concave boundaries and holes without dropping faces.
    poly=set_precision(poly,0.01)
    faces=constrained_delaunay_triangles(poly)
    assert abs(sum(t.area for t in faces.geoms)-poly.area)<max(1e-6,poly.area*1e-9), 'Incomplete surface triangulation'
    return [[[round(float(x),5),round(float(z),5)] for x,z in list(t.exterior.coords)[:3]] for t in faces.geoms]

def rings(poly):
    poly=set_precision(poly,0.01)
    polygons=list(poly.geoms) if hasattr(poly,'geoms') else [poly]
    return [[[round(float(x),5),round(float(z),5)] for x,z in ring.coords]
            for p in polygons if p.geom_type=='Polygon' for q in [orient(p,sign=1)] for ring in [q.exterior,*q.interiors]]

def street_surfaces(roads,bounds):
    asphalt=unary_union([LineString(r['points']).simplify(0.3).buffer(r['width']/2,cap_style=2,join_style=3) for r in roads])
    # Close narrow notches with bevels instead of preserving pointed OSM leftovers.
    asphalt=asphalt.buffer(1.2,quad_segs=1,join_style=3).buffer(-1.2,quad_segs=1,join_style=3)
    asphalt=set_precision(asphalt.simplify(0.6).intersection(bounds),0.01)
    pavement=set_precision(asphalt.buffer(3.2,join_style=3).intersection(bounds),0.01)
    return asphalt,pavement.difference(asphalt),pavement

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
    bounds=box(*project(BBOX[0],BBOX[1]),*project(BBOX[2],BBOX[3]))
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
        if t.get('railway') in ['rail','light_rail'] and number(t.get('layer'))>=1:
            c=coords(refs)
            if len(c)>1:
                line=LineString(c).intersection(bounds)
                for rail in (list(line.geoms) if hasattr(line,'geoms') else [line]):
                    if rail.geom_type=='LineString' and rail.length>10:rails.append([[rounded(x),rounded(z)] for x,z in rail.simplify(2).coords])
        if t.get('highway') in ['primary','secondary','tertiary','residential','unclassified','trunk'] and t.get('tunnel')!='yes' and number(t.get('layer'))>=0:
            c=coords(refs)
            if len(c)<2:continue
            line=LineString(c).intersection(bounds)
            lines=list(line.geoms) if hasattr(line,'geoms') else [line]
            for line in lines:
                if line.geom_type!='LineString' or line.length<5:continue
                width=number(t.get('width')) or max(9,min(26,(number(t.get('lanes')) or (3 if t['highway'] in ['primary','secondary'] else 2))*3.2))
                roads.append({'id':f'osm-{wid}','name':t.get('name',''),'width':rounded(width),'bridge':t.get('bridge') in ['yes','movable'] or line.intersects(water),'points':[[rounded(x),rounded(z)] for x,z in line.simplify(1).coords]})
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
      ('lamp','Чикагский фонарь',[1,8,1],'#414c4c',[100]),
    ]
    templates=[dict(id=p,name=n,kind='building' if p not in ['tree','lamp'] else 'obstacle',size=s,color=c,profile=p,lodDistances=d) for p,n,s,c,d in specs]
    objects=[]; source=[]; heights=Counter(); families=Counter(); seen_ids=Counter()
    for wid,t,p in buildings:
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
        h=max(6,min(600,h));families[profile]+=1;heights[method]+=1
        seen_ids[wid]+=1
        unique_id=wid if seen_ids[wid]==1 else f'{wid}-{seen_ids[wid]}'
        o=dict(id=f'osm-{unique_id}',templateId=profile,name=name or t.get('addr:street','Chicago building'),position=[rounded(rect.centroid.x),rounded(h/2),rounded(rect.centroid.y)],size=[rounded(w),rounded(h),rounded(d)],yaw=round(yaw,6))
        objects.append(o)
        source.append(dict(id=wid,name=name,height=rounded(h),heightSource=method,profile=profile,footprint=[[rounded(x),rounded(z)] for x,z in p.exterior.coords]))
    road_union,sidewalks,pavement=street_surfaces(roads,bounds)
    river_buffer=water.buffer(7)
    # No almost-coplanar ground beneath paving: it flickers through at overview distances.
    exposed_ground=bounds.difference(river_buffer).difference(pavement.union(road_union).buffer(0.02))
    assert exposed_ground.intersection(pavement.union(road_union)).area<1e-6
    terrain=[]
    for x in range(math.floor(bounds.bounds[0]/256)*256,math.ceil(bounds.bounds[2]/256)*256,256):
      for z in range(math.floor(bounds.bounds[1]/256)*256,math.ceil(bounds.bounds[3]/256)*256,256):
        p=box(x,z,x+256,z+256).intersection(exposed_ground)
        tris=triangles(p)
        if tris:terrain.append(dict(cell=[x,z],triangles=tris))
    # Riverwalk is an explicitly stylized lower terrace, not a surveyed elevation model.
    riverwalk=water.buffer(7).difference(water).intersection(bounds)
    # A usable spawn on State Street, south of the river, outside building bounds.
    spawn=project(-87.6278,41.8865)
    world=dict(version=3,environment='chicago-loop',spawn=[rounded(spawn[0]),1,rounded(spawn[1])],templates=templates,objects=objects)
    curbs=road_union.buffer(0.22,join_style=3).difference(road_union).intersection(sidewalks)
    terrace_lines=[[[rounded(x),rounded(z)] for x,z in p.exterior.simplify(2).coords] for p in (list(river_buffer.geoms) if hasattr(river_buffer,'geoms') else [river_buffer]) if p.geom_type=='Polygon']
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
    env=dict(rails=rails,roadSurface=triangles(road_union),sidewalks=triangles(sidewalks.difference(curbs)),curbs=triangles(curbs),curbEdges=rings(curbs),terraceWalls=terrace_lines,ramps=ramps,origin=[LON,LAT],bounds=list(map(rounded,bounds.bounds)),roads=roads,terrain=terrain,water=triangles(water),riverwalk=triangles(riverwalk),parks=[tri for p in parks for tri in triangles(p)],shorelines=[[[rounded(x),rounded(z)] for x,z in p.exterior.simplify(2).coords] for p in (list(water.geoms) if hasattr(water,'geoms') else [water]) if p.geom_type=='Polygon'])
    output=dict(world=world,environment=env,report=dict(buildings=len(objects),roads=len(roads),families=dict(families),heights=dict(heights),bounds=BBOX,origin=[LON,LAT],licence='ODbL-1.0',attribution='© OpenStreetMap contributors',waterArea=rounded(water.area)))
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
