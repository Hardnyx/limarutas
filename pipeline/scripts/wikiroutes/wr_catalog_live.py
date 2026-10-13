"""Read the public catalog without executing the destructive legacy builder."""
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, parse_qs

CATALOG_URL='https://wikiroutes.info/es/lima/catalog'

class CatalogParser(HTMLParser):
    def __init__(self):super().__init__();self.routes={};self.current=None
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag!='a' or 'tag-btn' not in attrs.get('class','').split():return
        url=urljoin(CATALOG_URL,attrs.get('href',''));rid=parse_qs(urlparse(url).query).get('routes',[''])[0]
        if not rid.isdigit() or urlparse(url).hostname!='wikiroutes.info':return
        item={'route_id':rid,'title':attrs.get('title',''),'url':url,'active':'no-active' not in attrs.get('class','').split()}
        if rid in self.routes and self.routes[rid]!=item:raise ValueError('Conflicting catalog route: '+rid)
        self.routes[rid]=item;self.current=item
    def handle_data(self,data):
        if self.current and not self.current['title']:self.current['title']=data.strip()
    def handle_endtag(self,tag):
        if tag=='a':self.current=None

def parse(html):
    parser=CatalogParser();parser.feed(html)
    if not parser.routes:raise ValueError('Empty or changed WikiRoutes catalog')
    return list(parser.routes.values())
