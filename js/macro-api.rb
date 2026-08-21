require "json"
require "base64"

class Vector2D
  attr_accessor :x, :y
  def initialize(x = 0, y = 0) = (@x = x.to_f; @y = y.to_f)
  def +(other) = Vector2D.new(@x + other.x, @y + other.y)
  def -(other) = Vector2D.new(@x - other.x, @y - other.y)
  def *(value) = Vector2D.new(@x * value.to_f, @y * value.to_f)
  def to_ary = [@x, @y]
end

class AffineMatrix2D
  attr_accessor :a, :b, :c, :d, :tx, :ty
  def initialize(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) = (@a, @b, @c, @d, @tx, @ty = a, b, c, d, tx, ty)
  def translate(x, y = nil) = (point = x.is_a?(Vector2D) ? x : Vector2D.new(x, y); @tx += point.x; @ty += point.y; self)
  def scale(x, y = x) = (@a *= x; @d *= y; self)
  def rotate(angle) = (cos = Math.cos(angle); sin = Math.sin(angle); @a, @b = @a * cos - @b * sin, @a * sin + @b * cos; self)
  def horizontal_flip = scale(-1, 1)
  alias flip_horizontally horizontal_flip
  def vertical_flip = scale(1, -1)
  alias flip_vertically vertical_flip
  def compose(matrix)
    other = matrix.is_a?(AffineMatrix2D) ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty] : Array(matrix)
    a, b, c, d, tx, ty = @a, @b, @c, @d, @tx, @ty
    @a = a * other[0] + c * other[1]; @b = b * other[0] + d * other[1]
    @c = a * other[2] + c * other[3]; @d = b * other[2] + d * other[3]
    @tx = a * other[4] + c * other[5] + tx; @ty = b * other[4] + d * other[5] + ty
    self
  end
end

class SviberMacroOutput
  def initialize(kind, records)
    @kind = kind
    @records = records
  end

  def write(value)
    text = value.to_s
    previous = @records.last
    if previous && previous["kind"] == @kind
      previous["value"] << text
    else
      @records << { "kind" => @kind, "value" => text }
    end
    text.bytesize
  end

  def print(*values)
    values.each { |value| write(value) }
    nil
  end

  def puts(*values)
    values = [""] if values.empty?
    values.each do |value|
      if value.is_a?(Array)
        puts(*value)
      else
        text = value.to_s
        write(text)
        write("\n") unless text.end_with?("\n")
      end
    end
    nil
  end

  def <<(value)
    write(value)
    self
  end

  def flush = self
  def sync = true
  def sync=(_value)
    true
  end
  def tty? = false
end

class SviberMacroAPI
  attr_reader :state

  def initialize
    @state = {}
  end

  def load_json(source)
    @state = JSON.parse(source)
    @state["metadata"] ||= {}
    @state["editor"] ||= {}
    @state["timing"] ||= { "offset" => 0, "initialBpm" => 120, "bpmChanges" => [] }
    @state["channels"] ||= []
    @state["events"] ||= []
    @state["snappees"] ||= []
    @state
  end

  def metadata = @state["metadata"]
  def editor = @state["editor"]
  def timing = @state["timing"]
  def channels = @state["channels"]
  def events = @state["events"]
  def snappees = @state["snappees"]

  def event(type, overrides = nil, **keywords)
    values = options(overrides, keywords)
    item = {
      "id" => next_id(events),
      "type" => type.to_s,
      "channel" => editor.fetch("currentChannel", channels.dig(0, "id") || 0),
      "time" => deep_copy(editor.fetch("currentTime", [0, 0, 1])),
      "selected" => true
    }.merge(values)
    events << item
    item
  end

  def tap(overrides = nil, **keywords) = event("tap", overrides, **keywords)
  def hold(overrides = nil, **keywords) = event("hold", overrides, **keywords)
  def drag(overrides = nil, **keywords) = event("drag", overrides, **keywords)
  def flick(overrides = nil, **keywords) = event("flick", overrides, **keywords)
  def bg_note(overrides = nil, **keywords) = event("bgNote", overrides, **keywords)

  def channel(name = "Channel", overrides = nil, **keywords)
    item = { "id" => next_id(channels), "name" => name.to_s, "active" => true }
      .merge(options(overrides, keywords))
    channels << item
    item
  end

  def snappee(type, overrides = nil, **keywords)
    item = {
      "id" => next_id(snappees), "type" => type.to_s, "name" => type.to_s,
      "active" => true, "transformation" => [1, 0, 0, 1, 0, 0]
    }.merge(options(overrides, keywords))
    snappees << item
    item
  end

  def find_event(value) = find(events, value)
  def find_channel(value) = find(channels, value)
  def find_snappee(value) = find(snappees, value)
  def remove_event(value) = remove(events, value)
  def remove_channel(value) = remove(channels, value)
  def remove_snappee(value) = remove(snappees, value)

  def raw_events
    result = []
    visit = lambda do |items|
      Array(items).each do |item|
        result << item
        visit.call(item["events"]) if item["type"] == "group"
      end
    end
    visit.call(events)
    result
  end

  def clips
    @state["clips"] ||= []
  end

  def find_event(value)
    raw_events.find { |item| item["id"].to_i == id_for(value) }
  end

  def remove_event(value)
    target = id_for(value)
    remove_from = lambda do |items|
      Array(items).each_with_index do |item, index|
        return items.delete_at(index) if item["id"].to_i == target
        removed = remove_from.call(item["events"]) if item["type"] == "group"
        return removed if removed
      end
      nil
    end
    remove_from.call(events)
  end

  def update_event(value, changes = {}) = update(events, value, changes)
  def update_channel(value, changes = {}) = update(channels, value, changes)
  def update_snappee(value, changes = {}) = update(snappees, value, changes)

  def select(*values)
    ids = ids_for(values)
    events.each { |item| item["selected"] = ids.include?(item["id"].to_i) }
    selected
  end

  def add_selection(*values)
    ids = ids_for(values)
    events.each { |item| item["selected"] = true if ids.include?(item["id"].to_i) }
    selected
  end

  def remove_selection(*values)
    ids = ids_for(values)
    events.each { |item| item["selected"] = false if ids.include?(item["id"].to_i) }
    selected
  end

  def clear_selection
    events.each { |item| item["selected"] = false }
    []
  end

  def selected = events.select { |item| item["selected"] }

  def current_time
    editor.fetch("currentTime", [0, 0, 1])
  end
  def current_time=(value)
    set_time(value)
  end
  def current_channel
    find_channel(editor["currentChannel"])
  end
  def current_channel=(value)
    set_current_channel(value)
  end
  def bpm_changes
    timing["bpmChanges"]
  end
  def bar_lines = (timing["barLines"] ||= [])
  def add_bar_line(time) = (bar_lines << { "time" => deep_copy(time) }; bar_lines.last)
  def remove_bar_line(time) = bar_lines.delete_if { |line| line["time"] == time }
  def copy(values = selected) = values.map { |value| event(value["type"], value) }
  def transform(things, matrix = nil, &block)
    matrix ||= AffineMatrix2D.new.tap(&block)
    values = matrix.respond_to?(:a) ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty] : matrix
    Array(things).each do |value|
      item = value.is_a?(Hash) ? value : value.instance_variable_get(:@state)
      next unless item && item["x"]
      x, y = item["x"], item["y"]
      item["x"], item["y"] = values[0] * x + values[2] * y + values[4], values[1] * x + values[3] * y + values[5]
    end
    things
  end

  def set_time(value)
    editor["timeSnapped"] = value.is_a?(Array)
    editor["currentTime"] = deep_copy(value)
  end

  def set_current_channel(value)
    editor["currentChannel"] = id_for(value)
  end

  private

  def stringify_keys(value)
    return value.each_with_object({}) { |(key, child), result| result[key.to_s] = stringify_keys(child) } if value.is_a?(Hash)
    return value.map { |child| stringify_keys(child) } if value.is_a?(Array)
    value
  end

  def options(overrides, keywords)
    base = overrides.is_a?(Hash) ? overrides : {}
    stringify_keys(base.merge(keywords))
  end

  def deep_copy(value) = JSON.parse(JSON.generate(value))
  def id_for(value) = (value.is_a?(Hash) ? value["id"] || value[:id] : value).to_i
  def ids_for(values) = values.flatten.map { |value| id_for(value) }.to_set
  def next_id(items) = (items.map { |item| item["id"].to_i }.max || -1) + 1
  def find(items, value) = items.find { |item| item["id"].to_i == id_for(value) }

  def remove(items, value)
    index = items.index { |item| item["id"].to_i == id_for(value) }
    index ? items.delete_at(index) : nil
  end

  def update(items, value, changes)
    item = find(items, value)
    item&.merge!(stringify_keys(changes))
    item
  end
end

module SviberMacroHelpers
  ANGLES = {
    u: -Math::PI / 2, up: -Math::PI / 2, d: Math::PI / 2, down: Math::PI / 2,
    l: Math::PI, left: Math::PI, r: 0, right: 0,
    ul: -3 * Math::PI / 4, lu: -3 * Math::PI / 4, up_left: -3 * Math::PI / 4, left_up: -3 * Math::PI / 4,
    ur: -Math::PI / 4, ru: -Math::PI / 4, up_right: -Math::PI / 4, right_up: -Math::PI / 4,
    dl: 3 * Math::PI / 4, ld: 3 * Math::PI / 4, down_left: 3 * Math::PI / 4, left_down: 3 * Math::PI / 4,
    dr: Math::PI / 4, rd: Math::PI / 4, down_right: Math::PI / 4, right_down: Math::PI / 4
  }.freeze
  def self.angle(value)
    value.is_a?(Symbol) ? (ANGLES[value] || value.to_s.to_f) : value.to_f
  end
  def self.beat(value)
    return value.to_a if value.is_a?(Rational)
    return value if value.is_a?(Array) && value.length == 3
    value.is_a?(Array) ? Rational(value[0], value[1]) : Rational(value.to_i, 1)
  end
end

class Location
  attr_reader :snap_point
  def initialize(*args)
    @snappee = nil
    if args.first.is_a?(Snappee)
      @snappee = args.shift; @snap_point = args.length > 1 ? args : args.first
      @x = @y = 0.0
    else
      @x = args[0].to_f; @y = args[1].to_f; @snap_point = nil
    end
  end
  def pos = Vector2D.new(@x, @y)
  def attached? = !@snappee.nil?
  def attach(snappee = nil, *point)
    @snappee = snappee || Snappee.list.find(&:active?)
    @snap_point = point.length > 1 ? point : point.first || [0, 0]
    self
  end
  def detach = (@snappee = nil; @snap_point = nil; self)
  def snappee = @snappee
  def snappee=(value)
    value.nil? ? detach : attach(value, *@snap_point.to_a)
  end
  def x = @x
  def x=(value)
    detach; @x = value.to_f
  end
  def y = @y
  def y=(value)
    detach; @y = value.to_f
  end
  def to_h = attached? ? { "attached" => true, "snappee" => @snappee.id, "snapPoint" => @snap_point } : { "attached" => false, "x" => @x, "y" => @y }
end

class TipPoint
  attr_accessor :type, :distance, :angle, :location, :time_seconds, :time_beats
  def initialize(type, **values) = (@type = type.to_s; @distance = values[:distance]; @angle = SviberMacroHelpers.angle(values[:angle]); @location = values[:location]; @time_seconds = values[:time_seconds]; @time_beats = values[:time_beats])
  def self.inherit = new(:inherit)
  def self.none = new(:none)
  def self.chain(**values) = new(:chain, **values)
  def self.drop(**values) = new(:drop, **values)
  def absolute? = !@location.nil?
  def relative? = !absolute?
  def time_in_seconds? = !@time_seconds.nil?
  def time_in_beats? = !time_in_seconds?
  def to_h = { "type" => @type, "tipPointSpawnDistance" => @distance, "tipPointSpawnAngle" => @angle, "tipPointSpawnTime" => (@time_beats || @time_seconds) }
end

class BpmChange
  def self.new(time, bpm) = ($sviber.timing["bpmChanges"] << { "time" => time.is_a?(Array) ? time : time.to_f, "bpm" => bpm.to_f }; wrap($sviber.timing["bpmChanges"].last))
  def self.wrap(raw) = allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
  def self.list = $sviber.timing["bpmChanges"].map { |item| wrap(item) }
  def time = @raw["time"]
  def bpm = @raw["bpm"]
  def bpm=(value)
    @raw["bpm"] = value.to_f
  end
  def delete = $sviber.timing["bpmChanges"].delete(@raw)
end

class BarLine
  def self.new(time) = ($sviber.bar_lines << { "time" => time.is_a?(Array) ? time : time.to_f }; wrap($sviber.bar_lines.last))
  def self.wrap(raw) = allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
  def self.list = $sviber.bar_lines.map { |item| wrap(item) }
  def time = @raw["time"]
  def delete = $sviber.bar_lines.delete(@raw)
end

class Channel
  def self.new(name: nil, color: nil) = wrap($sviber.channel(name || "Channel", color: color))
  def self.wrap(raw) = allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
  def self.get(value) = value.is_a?(String) ? wrap($sviber.channels.find { |item| item["name"] == value }) : wrap($sviber.channels[value.to_i - 1])
  def self.get_by_id(value) = wrap($sviber.find_channel(value))
  def self.current = wrap($sviber.current_channel)
  def self.list = $sviber.channels.map { |item| wrap(item) }
  def name = @raw["name"]
  def name=(value)
    @raw["name"] = value.to_s
  end
  def color = @raw["color"]
  def color=(value)
    @raw["color"] = value.is_a?(Integer) ? format("#%06x", value) : value.to_s
  end
  def id = @raw["id"]
  def active? = @raw["active"] != false
  def activate = (@raw["active"] = true; self)
  def deactivate = (@raw["active"] = false; self)
  def current? = $sviber.editor["currentChannel"] == id
  def select = ($sviber.set_current_channel(self); self)
  def events = $sviber.raw_events.select { |item| item["channel"] == id && item["type"] != "group" }.map { |item| Event.wrap(item) }
  def move_up = reorder(-1)
  def move_down = reorder(1)
  def reorder(delta) = (index = $sviber.channels.index(@raw); target = index + delta; $sviber.channels[index], $sviber.channels[target] = $sviber.channels[target], $sviber.channels[index] if index && target.between?(0, $sviber.channels.length - 1); self)
  def delete = $sviber.remove_channel(self)
  def to_h = @raw
  def to_json(*args) = to_h.to_json(*args)
end

class Snappee
  def self.new(type = :rectangularMesh, **values) = wrap($sviber.snappee(type, **values))
  def self.wrap(raw) = allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
  def self.get(value) = value.is_a?(String) ? wrap($sviber.snappees.find { |item| item["name"] == value }) : wrap($sviber.snappees[value.to_i])
  def self.get_by_id(value) = wrap($sviber.find_snappee(value))
  def self.list = $sviber.snappees.map { |item| wrap(item) }
  def self.selected = list.find(&:selected?)
  def self.deselect = list.each { |item| item.instance_variable_get(:@raw)["selected"] = false }
  def id = @raw["id"]
  def name = @raw["name"]
  def name=(value)
    @raw["name"] = value.to_s
  end
  def color = @raw["color"]
  def color=(value)
    @raw["color"] = value.is_a?(Integer) ? format("#%06x", value) : value.to_s
  end
  def active? = @raw["active"] != false
  def selected? = @raw["selected"] == true
  def activate = (@raw["active"] = true; self)
  def deactivate = (@raw["active"] = false; self)
  def select = (Snappee.deselect; @raw["selected"] = true; self)
  def pos(i = 0, j = 0) = Vector2D.new(@raw["centerX"] || @raw["topLeftX"] || 0, @raw["centerY"] || @raw["topLeftY"] || 0)
  def duplicate(name = self.name, color = self.color) = Snappee.wrap($sviber.snappee(@raw["type"], @raw.merge("id" => nil, "name" => name, "color" => color)))
  def move_up = reorder(-1)
  def move_down = reorder(1)
  def reorder(delta) = (index = $sviber.snappees.index(@raw); target = index + delta; $sviber.snappees[index], $sviber.snappees[target] = $sviber.snappees[target], $sviber.snappees[index] if index && target.between?(0, $sviber.snappees.length - 1); self)
  def delete = $sviber.remove_snappee(self)
  def to_h = @raw
  def to_json(*args) = to_h.to_json(*args)
end

%i[RectangularMesh RadialMesh ParametricMesh RegularPolygonCurve BezierCurve PenCurve ParametricCurve].each { |name| Object.const_set(name, Snappee) unless Object.const_defined?(name) }

class Event
  def self.wrap(raw) = raw && allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
  def self.new(type: :tap, **values) = wrap($sviber.event(type.to_s, **values.transform_keys { |key| key.to_s.gsub("_", "") == "bgNote" ? "type" : key }))
  def self.list = $sviber.raw_events.map { |item| wrap(item) }
  def self.selection = list.select(&:selected?)
  def id = @raw["id"]
  def type = @raw["type"]
  def type=(value)
    @raw["type"] = value.to_s
  end
  def movable? = %w[tap hold drag flick bgNote group].include?(type)
  def have_time? = !@raw["time"].nil? || group?
  def have_channel? = type != "group" && !@raw["channel"].nil?
  def have_duration? = !@raw["duration"].nil?
  def have_text? = %w[tap hold flick bgNote bigText comment].include?(type)
  def tip_pointable? = %w[tap hold drag flick].include?(type)
  def group? = type == "group"
  def location = Location.new(@raw["x"] || 0, @raw["y"] || 0)
  def location=(value)
    @raw["attached"] = false; @raw["x"] = value.x; @raw["y"] = value.y; self
  end
  def anchor = location
  def anchor=(value)
    self.location = value
  end
  def text = @raw["text"]
  def text=(value)
    @raw["text"] = value.to_s
  end
  def angle = @raw["angle"]
  def angle=(value)
    @raw["angle"] = SviberMacroHelpers.angle(value)
  end
  def duration = @raw["duration"]
  def duration=(value)
    @raw["duration"] = value.is_a?(Rational) ? value.to_f : value
  end
  def time = group? ? self.class.group_time(@raw) : @raw["time"]
  def time=(value)
    group? ? translate_time(value) : (@raw["time"] = value)
  end
  def self.group_time(raw) = raw.fetch("events", []).flat_map { |item| item["type"] == "group" ? [group_time(item)] : [item["time"]] }.compact.min_by { |item| item.is_a?(Array) ? item[0].to_f + item[1].to_f / item[2].to_f : item.to_f }
  def translate_time(value) = (delta = value.to_f - self.class.group_time(@raw).to_f; Event.list.each { |item| item.raw["time"] = item.raw["time"].to_f + delta if item.raw["time"] && item.raw != @raw }; self)
  def channel = Channel.get_by_id(@raw["channel"])
  def channel=(value)
    @raw["channel"] = value.id
  end
  def events = @raw.fetch("events", []).map { |item| Event.wrap(item) }
  def color = @raw["color"]
  def color=(value)
    @raw["color"] = value
  end
  def delete = $sviber.remove_event(self)
  def selected? = @raw["selected"] == true
  def raw = @raw
  def to_h = @raw
end

class Clip
  def self.new(events, name = nil) = (raw = { "name" => name || "Clip #{$sviber.clips.length + 1}", "data" => { "events" => events.map { |item| item.respond_to?(:raw) ? item.raw : item } } }; $sviber.clips << raw; wrap(raw))
  def self.wrap(raw) = raw && allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
  def self.get(value) = wrap($sviber.clips[value.to_i])
  def name = @raw["name"]
  def name=(value)
    @raw["name"] = value.to_s
  end
  def move_up = reorder(-1)
  def move_down = reorder(1)
  def reorder(delta) = (index = $sviber.clips.index(@raw); target = index + delta; $sviber.clips[index], $sviber.clips[target] = $sviber.clips[target], $sviber.clips[index] if index && target.between?(0, $sviber.clips.length - 1); self)
  def delete = $sviber.clips.delete(@raw)
  def paste(time, channel) = (@raw.dig("data", "events") || []).map { |item| $sviber.event(item["type"], item.merge("time" => time, "channel" => channel.id)) }
  def to_h = @raw
  def to_json(*args) = to_h.to_json(*args)
end

require "set"
$sviber_macro_logs = []
$stdout = SviberMacroOutput.new("log", $sviber_macro_logs)
$stderr = SviberMacroOutput.new("error", $sviber_macro_logs)
$sviber = SviberMacroAPI.new

def sviber = $sviber
def state = $sviber.state
def chart = $sviber.state
def tap(...) = $sviber.tap(...)
def t(location = nil, text = "") = location.is_a?(Hash) ? $sviber.tap(location) : $sviber.tap("x" => location&.x, "y" => location&.y, "text" => text)
def hold(location = nil, duration = nil, text = "") = location.is_a?(Hash) ? $sviber.hold(location) : $sviber.hold("x" => location&.x, "y" => location&.y, "duration" => duration, "text" => text)
def h(...) = hold(...)
def drag(location = nil) = location.is_a?(Hash) ? $sviber.drag(location) : $sviber.drag("x" => location&.x, "y" => location&.y)
def d(...) = drag(...)
def flick(location = nil, angle = 0, text = "") = location.is_a?(Hash) ? $sviber.flick(location) : $sviber.flick("x" => location&.x, "y" => location&.y, "angle" => SviberMacroHelpers.angle(angle), "text" => text)
def f(...) = flick(...)
def bg_note(location = nil, angle = 0, duration = 0, text = "") = location.is_a?(Hash) ? $sviber.bg_note(location) : $sviber.bg_note("x" => location&.x, "y" => location&.y, "angle" => SviberMacroHelpers.angle(angle), "duration" => duration, "text" => text)
def bg(...) = bg_note(...)
def channel(...) = $sviber.channel(...)
def add_channel(...) = $sviber.channel(...)
def snappee(...) = $sviber.snappee(...)
def add_snappee(...) = $sviber.snappee(...)
def find_event(...) = $sviber.find_event(...)
def find_channel(...) = $sviber.find_channel(...)
def find_snappee(...) = $sviber.find_snappee(...)
def update_event(...) = $sviber.update_event(...)
def update_channel(...) = $sviber.update_channel(...)
def update_snappee(...) = $sviber.update_snappee(...)
def remove_event(...) = $sviber.remove_event(...)
def remove_channel(...) = $sviber.remove_channel(...)
def remove_snappee(...) = $sviber.remove_snappee(...)
def select(...) = $sviber.select(...)
def add_selection(...) = $sviber.add_selection(...)
def remove_selection(...) = $sviber.remove_selection(...)
def clear_selection = $sviber.clear_selection
def set_time(...) = $sviber.set_time(...)
def set_current_channel(...) = $sviber.set_current_channel(...)
def selected_events = Event.selection
def selected_snappee = Snappee.selected
def chart_events = Event.list
def chart_channels = Channel.list
def chart_snappees = Snappee.list
def clips = $sviber.clips.map { |item| Clip.wrap(item) }
def b(value = nil) = value.nil? ? $sviber.current_time : $sviber.set_time(value)
def b!(value = nil) = value.nil? ? $sviber.current_time : $sviber.set_time(value)
def bpm(value) = (existing = $sviber.timing["bpmChanges"].find { |item| item["time"] == $sviber.current_time }; existing ? existing["bpm"] = value.to_f : $sviber.timing["bpmChanges"] << { "time" => $sviber.current_time, "bpm" => value.to_f }; value)
def g(values, color = nil) = $sviber.event("group", "events" => values.map { |item| item.is_a?(Hash) ? item : item.to_h }, "color" => color)
def copy(values = $sviber.selected) = $sviber.copy(values)
def transform(things, matrix = nil, &block) = $sviber.transform(things, matrix, &block)
def log(*values) = $stdout.puts(*values)
def l(*args) = Location.new(*args)
def c(name) = (Channel.get(name) || Channel.new(name: name)).select
def s(value = 0) = Snappee.get(value)
def tpc(distance, angle = nil, time = nil) = TipPoint.chain(distance: distance, angle: angle, time_beats: time)
def tpd(distance, angle = nil, time = nil) = TipPoint.drop(distance: distance, angle: angle, time_beats: time)
def big_text(duration, text = "") = $sviber.event("bigText", "duration" => duration, "text" => text)
def grid(duration) = $sviber.event("grid", "duration" => duration)
def diamond_grid(duration) = $sviber.event("diamondGrid", "duration" => duration)
def hexagon(duration) = $sviber.event("hexagon", "duration" => duration)
