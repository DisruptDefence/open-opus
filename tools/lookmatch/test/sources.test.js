import test from 'node:test';
import assert from 'node:assert/strict';
import * as commons from '../lib/sources/commons.mjs';
import * as mapillary from '../lib/sources/mapillary.mjs';
import { USER_AGENT } from '../lib/http.mjs';

const view = { lat: 12.3456, lon: -45.6789, headingTrue: 90 };
const page = (id, extra = {}, em = {}, wt = '') => ({
  pageid: id, title: `File:Street ${id}.jpg`, coordinates: [{ lat: 12.3457, lon: -45.679, primary: '', type: 'camera' }],
  revisions: [{ slots: { main: { '*': wt } } }],
  imageinfo: [{ width: 1600, height: 1000, mime: 'image/jpeg', thumburl: `https://upload.example/${id}.jpg`, descriptionurl: `https://commons.example/wiki/File:${id}`, extmetadata: {
    Artist: { value: '<a href="//x" title="User:Ann">Ann &amp; Bo</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' }, DateTimeOriginal: { value: '2019-07-04 10:00:00' }, ...em } }], ...extra,
});

test('Commons request: the geosearch round the viewpoint, the generic user agent and nothing else in the headers', () => {
  const [r] = commons.buildRequests(view, { radius: 80 }), u = new URL(r.url);
  assert.equal(u.origin + u.pathname, 'https://commons.wikimedia.org/w/api.php');
  assert.equal(u.searchParams.get('generator'), 'geosearch'); assert.equal(u.searchParams.get('ggscoord'), '12.3456|-45.6789'); assert.equal(u.searchParams.get('ggsradius'), '80'); assert.equal(u.searchParams.get('ggsnamespace'), '6');
  assert.deepEqual(r.headers, { 'User-Agent': USER_AGENT }); assert.equal(USER_AGENT, 'lookmatch/1 (open-source scene tool)');
});
test('Commons parsing: author without tags, licence, heading from metadata or the location template, camera position', () => {
  const out = commons.parse({ query: { pages: {
    1: page(1), 2: page(2, {}, { GPSImgDirection: { value: '270.5' } }), 3: page(3, {}, {}, 'x {{Location|12.3|-45.6|heading:123}} y'),
    4: page(4, { coordinates: [{ lat: 1, lon: 2, primary: '', type: 'object' }] }, {}, '{{Object location|1|2|heading:5}}'), 5: { pageid: 5, title: 'File:x.jpg' },
  } } });
  assert.equal(out.length, 4); const by = Object.fromEntries(out.map((c) => [c.id, c]));
  assert.equal(by.c1.author, 'Ann & Bo'); assert.equal(by.c1.licence, 'CC BY-SA 4.0'); assert.equal(by.c1.heading, null); assert.equal(by.c1.positionOf, 'camera'); assert.equal(by.c1.title, 'Street 1.jpg');
  assert.equal(by.c2.heading, 270.5); assert.equal(by.c3.heading, 123); assert.equal(by.c4.heading, null, 'an object location template is not a camera heading'); assert.equal(by.c4.positionOf, 'object');
  assert.equal(by.c1.downloadUrl, 'https://upload.example/1.jpg'); assert.equal(by.c1.date, '2019-07-04 10:00:00');
});
test('Commons paging merges pages and follows the continue block', () => {
  const req = commons.buildRequests(view)[0], a = { continue: { rvcontinue: 'abc', continue: '||' }, query: { pages: { 1: { pageid: 1, x: 1 } } } };
  const next = commons.nextRequest(a, req); assert.equal(new URL(next.url).searchParams.get('rvcontinue'), 'abc'); assert.equal(commons.nextRequest({ query: {} }, req), null);
  assert.deepEqual(commons.mergeAnswers(a, { query: { pages: { 1: { y: 2 }, 2: { pageid: 2 } } } }).query.pages, { 1: { pageid: 1, x: 1, y: 2 }, 2: { pageid: 2 } });
});

const TOKEN = 'MLY|test-token-123';
test('Mapillary request: bounding box round the point, token only in the Authorization header, no other detail', () => {
  const [r] = mapillary.buildRequests(view, { radius: 80, token: TOKEN }), u = new URL(r.url);
  assert.equal(u.origin + u.pathname, 'https://graph.mapillary.com/images');
  assert.ok(!r.url.includes(TOKEN) && !r.url.includes('test-token') && !r.url.includes('access_token'));
  assert.deepEqual(r.headers, { 'User-Agent': USER_AGENT, Authorization: `OAuth ${TOKEN}` });
  const [w, s, e, n] = u.searchParams.get('bbox').split(',').map(Number); assert.ok(w < view.lon && e > view.lon && s < view.lat && n > view.lat && n - s < 0.003);
  for (const f of ['id', 'thumb_1024_url', 'computed_geometry', 'computed_compass_angle', 'captured_at', 'creator']) assert.ok(u.searchParams.get('fields').split(',').includes(f));
  assert.equal(mapillary.enabled({}), false); assert.equal(mapillary.enabled({ MAPILLARY_TOKEN: ' ' }), false); assert.equal(mapillary.enabled({ MAPILLARY_TOKEN: 'x' }), true);
});
test('Mapillary parsing against a hand-written fixture: licence, heading always known, entries without a compass angle dropped', () => {
  const out = mapillary.parse({ data: [
    { id: '111', thumb_1024_url: 'https://cdn.example/111.jpg', computed_geometry: { type: 'Point', coordinates: [-45.679, 12.3457] }, computed_compass_angle: 359.5, captured_at: 1561975800000, creator: { username: 'walker', id: '9' } },
    { id: '222', thumb_1024_url: 'https://cdn.example/222.jpg', computed_geometry: { type: 'Point', coordinates: [-45.68, 12.346] }, captured_at: 1561975800000 },
  ] });
  assert.equal(out.length, 1); const c = out[0];
  assert.equal(c.licence, 'CC BY-SA 4.0'); assert.equal(c.heading, 359.5); assert.equal(c.lat, 12.3457); assert.equal(c.lon, -45.679); assert.equal(c.author, 'walker'); assert.equal(c.date, '2019-07-01'); assert.equal(c.pageUrl, 'https://www.mapillary.com/app/?pKey=111');
});
