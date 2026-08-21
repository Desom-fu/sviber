require_relative "../js/macro-api.rb"
$stdout = STDOUT
$stderr = STDERR

$sviber.load_json({
  "editor" => { "currentChannel" => 0, "currentTime" => [0, 0, 1] },
  "channels" => [{ "id" => 0, "name" => "Main", "active" => true }],
  "events" => [], "snappees" => [], "clips" => [],
  "timing" => { "bpmChanges" => [] }
}.to_json)

channel = Channel.current
channel.name = "Edited"
note = Event.new(type: :tap, location: Location.new(2, 3), time: Rational(1, 2))
raise "rational time" unless note.time == Rational(1, 2)
note.angle = :up
group = g([note], 0xff0000)
group.location = Location.new(5, 6)
raise "group translation" unless group.events.first.location.x == 7
send(:b!, 3)
b(-1)
raise "b relative" unless b == Rational(2)
raise "seconds tip point" unless tpc(10, :right, 1.5).time_in_seconds?
STDERR.puts "ruby macro smoke ok"
