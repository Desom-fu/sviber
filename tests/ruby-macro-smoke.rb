require_relative "../js/macro-api.rb"
$stdout = STDOUT
$stderr = STDERR

SviberMacroInternals.load_json({
  "editor" => { "currentChannel" => 0, "currentTime" => [0, 0, 1] },
  "channels" => [{ "id" => 0, "name" => "Main", "color" => "#ffffff", "active" => true }],
  "events" => [], "snappees" => [], "clips" => [],
  "timing" => { "offset" => 0, "initialBpm" => 120, "bpmChanges" => [], "barLines" => [] }
})

channel = Channel.current
channel.name = "Edited"
raise "Channel.get accepted zero as a 1-based number" unless Channel.get(0).nil?
note = Event.new(type: :tap, location: Location.new(2, 3), time: Rational(1, 2))
raise "rational time" unless note.time == Rational(1, 2)
raise "named event subclass" unless t(Location.new(0, 0)).is_a?(Tap)
group = g([note], 0xff0000)
group.location = Location.new(5, 6)
raise "group translation" unless group.events.first.location.x == 7
send(:b!, 3)
b(-1)
raise "b relative" unless b == Rational(2)
raise "seconds tip point" unless tpc(10, :right, 1.5).time_in_seconds?
mesh = RectangularMesh.new(-10, 10, 10, -10, 2, 2)
raise "real snappee subclass" unless mesh.is_a?(RectangularMesh)
radial = RadialMesh.new(0, 0, 10, 4, 1, :up)
raise "radial direction argument" unless radial.pos(0, 1).x.abs < 1e-12 && radial.pos(0, 1).y == 10.0
polygon = RegularPolygonCurve.new(0, 0, 10, :up, 4, 1)
raise "polygon direction argument" unless polygon.pos(0).x.abs < 1e-12 && polygon.pos(0).y == 10.0
parametric = ParametricMesh.new([0, 2], [0, 2], "i * 10 + j", "j - i")
raise "parametric mesh expression" unless parametric.pos(2, 1).to_ary == [21.0, -1.0]
parametric_curve = ParametricCurve.new([0, 4], "cos(i * pi / 2) * 10", "i ^ 2")
raise "parametric curve expression" unless parametric_curve.pos(2).to_ary == [-10.0, 4.0]
raise "Snappee.get accepted a negative 0-based number" unless Snappee.get(-1).nil?
begin
  Location.new(mesh, [1, 1])
  raise "Ruby accepted an array mesh location"
rescue TypeError
end
reassigned = Location.new(9, -9)
reassigned.snappee = mesh
raise "snappee assignment did not choose nearest point" unless reassigned.pos.to_ary == [10.0, -10.0]
note.tip_point = TipPoint.chain(location: Location.new(4, 5), time_beats: 1)
transform(note) { translate(1, 2) }
raise "transform omitted absolute tip point" unless note.tip_point.location.pos.to_ary == [5.0, 7.0]
begin
  transform(channel) { translate(1, 2) }
  raise "transform accepted a channel"
rescue TypeError
end
directional = f(Location.new(0, 0), :up)
raise "up direction is not positive y" unless directional.angle == Math::PI / 2
raise "up-left direction" unless f(Location.new(0, 0), :up_left).angle == 3 * Math::PI / 4
begin
  f(Location.new(0, 0), "up")
  raise "Ruby accepted a string direction"
rescue TypeError
end
clip = Clip.new([group.events.first])
raise "clip data is not relative" unless clip.to_h.dig("data", "events", 0, "time") == [0, 0, 1]
raise "clip paste wrapper" unless clip.paste(3, channel).first.is_a?(Tap)
raise "Clip.get accepted a negative index" unless Clip.get(-1).nil?

direct_child = Tap.new(location: Location.new(1, 1), channel: channel, text: "direct child")
direct_group = Group.new(events: [direct_child])
raise "Group.new left its child at top level" if channel.events.any? { |event| event.have_text? && event.text == "direct child" }
raise "Group.new lost its child" unless direct_group.events.first.text == "direct child"

begin
  Event.new(type: :tap, time: [1, 2])
  raise "Ruby accepted an array beat"
rescue TypeError
end

begin
  Event.new(location: Location.new(0, 0))
  raise "Ruby accepted Event.new without type"
rescue ArgumentError
end

begin
  b(nil)
  raise "Ruby accepted nil as a beat"
rescue TypeError
end

temporary = Channel.new(name: "Temporary")
temporary.delete
begin
  temporary.select
  raise "deleted channel remained usable"
rescue RuntimeError
end
STDERR.puts "ruby macro smoke ok"
