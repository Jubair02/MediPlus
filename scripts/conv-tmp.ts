import sharp from 'sharp'
const s = await sharp('/home/z/my-project/public/images/rx-sample.png').stats()
const mean = s.channels.map((c) => Math.round(c.mean))
const stdev = s.channels.map((c) => Math.round(c.stdev))
console.log('channel means:', mean, 'stdevs:', stdev)
// also downscale sample check: unique-ish colors via resize to 16x16 raw
const { data } = await sharp('/home/z/my-project/public/images/rx-sample.png').resize(16, 16).raw().toBuffer({ resolveWithObject: true })
const uniq = new Set<Buffer>()
for (let i = 0; i < data.length; i += 3) uniq.add(Buffer.from(data.subarray(i, i + 3)))
console.log('distinct colors in 16x16 thumbnail:', uniq.size)
