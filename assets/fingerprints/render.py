"""Export hand layers at 4x for Koya's texture loader. Requires rsvg-convert."""
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
root = Path(__file__).resolve().parent
source = ET.parse(root / 'hand.svg').getroot()
ET.register_namespace('', 'http://www.w3.org/2000/svg')
for side in ['left', 'right']:
    for layer in source:
        svg = ET.Element(source.tag, source.attrib)
        group = ET.SubElement(svg, '{http://www.w3.org/2000/svg}g', {'transform': 'translate(240 0) scale(-1 1)'} if side == 'right' else {})
        group.append(layer)
        data = ET.tostring(svg)
        subprocess.run(['rsvg-convert', '-w', '960', '-h', '1280', '-o', str(root / (side + '-' + layer.attrib['id'] + '.png'))], input=data, check=True)
        if layer.attrib['id'] != 'base':
            import copy
            selected = copy.deepcopy(svg)
            for path in selected.iter('{http://www.w3.org/2000/svg}path'):
                path.set('fill-opacity', '.08')
                path.set('stroke', 'white')
                path.set('stroke-width', '2.6')
                path.set('stroke-linejoin', 'round')
            subprocess.run(['rsvg-convert', '-w', '960', '-h', '1280', '-o', str(root / (side + '-' + layer.attrib['id'] + '-selected.png'))], input=ET.tostring(selected), check=True)
