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
  def initialize(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0)
    if a.is_a?(Array)
      @a, @b, @c, @d, @tx, @ty = a
    else
      @a, @b, @c, @d, @tx, @ty = a, b, c, d, tx, ty
    end
  end
  def translate(x, y = nil) = (point = x.is_a?(Vector2D) ? x : Vector2D.new(x, y); @tx += point.x; @ty += point.y; self)
  def scale(x, y = x) = (@a *= x; @b *= x; @c *= y; @d *= y; self)
  def rotate(angle) = compose([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0])
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
    type = { "bg_note" => "bgNote", "big_text" => "bigText", "diamond_grid" => "diamondGrid" }.fetch(type.to_s, type.to_s)
    values["time"] = SviberMacroHelpers.beat(values["time"]) if values.key?("time")
    values["duration"] = SviberMacroHelpers.beat(values["duration"]) if values["duration"].is_a?(Integer) || values["duration"].is_a?(Rational) || values["duration"].is_a?(Array)
    if values["location"].is_a?(Location)
      values.merge!(values["location"].to_h)
      values.delete("location")
    end
    values["angle"] = SviberMacroHelpers.angle(values["angle"]) if values.key?("angle")
    values["color"] = SviberMacroHelpers.css_color(values["color"]) if values.key?("color")
    item = {
      "id" => next_id(events),
      "type" => type,
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
    if name.nil? || name.to_s.empty? || name.to_s == "Channel"
      ordinal = channels.length + 1; ordinal += 1 while channels.any? { |item| item["name"] == "Channel #{ordinal}" }; name = "Channel #{ordinal}"
    end
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
    raw_events.each { |item| item["selected"] = ids.include?(item["id"].to_i) }
    selected
  end

  def add_selection(*values)
    ids = ids_for(values)
    raw_events.each { |item| item["selected"] = true if ids.include?(item["id"].to_i) }
    selected
  end

  def remove_selection(*values)
    ids = ids_for(values)
    raw_events.each { |item| item["selected"] = false if ids.include?(item["id"].to_i) }
    selected
  end

  def clear_selection
    raw_events.each { |item| item["selected"] = false }
    []
  end

  def selected = raw_events.select { |item| item["selected"] }

  def current_time
    value = editor.fetch("currentTime", [0, 0, 1])
    value.is_a?(Array) ? SviberMacroHelpers.rational(value) : value
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
  def copy(values = selected)
    values = values.map { |value| value.respond_to?(:raw) ? value.raw : value }
    return [] if values.empty?
    origin = values.map { |value| event_time(value) }.min
    channels = values.filter_map { |value| value["channel"]&.to_i }
    channel_origin = channels.min || 0
    values.map do |value|
      copy = deep_copy(value)
      copy.delete("id")
      copy["time"] = SviberMacroHelpers.beat(current_time + event_time(value) - origin) if copy.key?("time")
      copy["channel"] = id_for(current_channel) + copy["channel"].to_i - channel_origin if copy.key?("channel")
      event(copy["type"], copy)
    end
  end
  def transform(things, matrix = nil, &block)
    matrix ||= AffineMatrix2D.new.tap(&block)
    values = matrix.respond_to?(:a) ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty] : matrix
    visit = lambda do |item|
      item = item.raw if item.respond_to?(:raw)
      next unless item.is_a?(Hash)
      Array(item["events"]).each { |child| visit.call(child) } if item["type"] == "group"
      if item["attached"] && (snap = find_snappee(item["snappee"]))
        point = Snappee.wrap(snap).pos(*Array(item["snapPoint"]))
        item["attached"] = false; item["x"] = values[0] * point.x + values[2] * point.y + values[4]; item["y"] = values[1] * point.x + values[3] * point.y + values[5]
        item.delete("snappee"); item.delete("snapPoint")
      elsif item.key?("x")
        x, y = item["x"].to_f, item["y"].to_f
        item["x"], item["y"] = values[0] * x + values[2] * y + values[4], values[1] * x + values[3] * y + values[5]
      end
      if item["transformation"]
        a, b, c, d, tx, ty = item["transformation"]
        item["transformation"] = [values[0] * a + values[2] * b, values[1] * a + values[3] * b, values[0] * c + values[2] * d, values[1] * c + values[3] * d, values[0] * tx + values[2] * ty + values[4], values[1] * tx + values[3] * ty + values[5]]
      end
    end
    Array(things).each { |value| visit.call(value) }
    things
  end

  def set_time(value)
    if value.is_a?(Integer) || value.is_a?(Rational)
      editor["timeSnapped"] = true; editor["currentTime"] = SviberMacroHelpers.beat(value)
    else
      raise TypeError, "time must be Integer or Rational" unless value.is_a?(Array)
      editor["timeSnapped"] = true; editor["currentTime"] = SviberMacroHelpers.beat(value)
    end
    current_time
  end

  def event_time(item)
    return item["time"] ? SviberMacroHelpers.rational(item["time"]) : Array(item["events"]).map { |child| event_time(child) }.min || Rational(0)
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
  def id_for(value) = (value.is_a?(Hash) ? value["id"] || value[:id] : value.respond_to?(:id) ? value.id : value).to_i
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
    key = value.is_a?(Symbol) ? value : value.to_s.downcase.to_sym
    ANGLES.key?(key) ? ANGLES[key] : value.to_f
  end
  def self.rational(value)
    return value if value.is_a?(Rational)
    return Rational(value[0], value[1]) if value.is_a?(Array) && value.length == 2
    return Rational(value[0].to_i * value[2].to_i + value[1].to_i, value[2].to_i) if value.is_a?(Array) && value.length == 3
    raise TypeError, "beat must be Integer or Rational" unless value.is_a?(Integer)
    Rational(value, 1)
  end
  def self.beat(value)
    number = rational(value); whole = number.numerator / number.denominator; remainder = number - whole; [whole, remainder.numerator, remainder.denominator]
  end
  def self.css_color(value)
    return format("#%06x", value) if value.is_a?(Integer) && value.between?(0, 0xffffff)
    text = value.to_s.strip.downcase
    return text.gsub(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, '#\\1\\1\\2\\2\\3\\3') if text.match?(/\A#[0-9a-f]{3}\z/)
    if (match = text.match(/\Argba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/))
      return "#%02x%02x%02x" % match.captures.map(&:to_i)
    end
    { "red" => "#ff0000", "green" => "#008000", "blue" => "#0000ff", "white" => "#ffffff", "black" => "#000000", "yellow" => "#ffff00" }.fetch(text, text)
  end
end

class Location
  attr_reader :snap_point
  def initialize(*args)
    @snappee = nil
    if args.first.is_a?(Snappee)
      @snappee = args.shift; @snap_point = args.length > 1 ? args : args.first
      @snap_point ||= 0; @x = @y = 0.0
    else
      @x = args[0].to_f; @y = args[1].to_f; @snap_point = nil
    end
  end
  def pos = attached? ? @snappee.pos(*Array(@snap_point)) : Vector2D.new(@x, @y)
  def attached? = !@snappee.nil?
  def attach(snappee = nil, *point)
    if snappee
      @snappee = snappee.is_a?(Snappee) ? snappee : Snappee.wrap(snappee)
      @snap_point = point.length > 1 ? point : (point.first || 0)
    else
      candidates = Snappee.list.select(&:active?).map { |item| [item, item.nearest_point(@x, @y)] }.min_by { |(_, hit)| hit[:distance] }
      if candidates
        @snappee, hit = candidates; @snap_point = hit[:snap_point]
      end
    end
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
  def initialize(type, **values)
    raise ArgumentError, "distance/angle and location are incompatible" if values[:location] && (values[:distance] || values[:angle])
    raise ArgumentError, "time_seconds and time_beats are incompatible" if values[:time_seconds] && values[:time_beats]
    @type = type.to_s; @distance = values[:distance]; @angle = values[:angle].nil? ? nil : SviberMacroHelpers.angle(values[:angle]); @location = values[:location]; @time_seconds = values[:time_seconds]; @time_beats = values[:time_beats]
  end
  def self.inherit = new(:inherit)
  def self.none = new(:none)
  def self.chain(*args, **values)
    values = args.first.is_a?(Hash) ? args.first.transform_keys(&:to_sym) : (args.first.is_a?(Location) ? { location: args.first, time_beats: args[1] } : { distance: args[0], angle: args[1], time_beats: args[2] }).merge(values)
    new(:chain, **values)
  end
  def self.drop(*args, **values)
    values = args.first.is_a?(Hash) ? args.first.transform_keys(&:to_sym) : (args.first.is_a?(Location) ? { location: args.first, time_beats: args[1] } : { distance: args[0], angle: args[1], time_beats: args[2] }).merge(values)
    new(:drop, **values)
  end
  def absolute? = !@location.nil?
  def relative? = !absolute?
  def time_in_seconds? = !@time_seconds.nil?
  def time_in_beats? = !time_in_seconds?
  def to_h
    result = { "tipPointSpawnType" => @type }
    if absolute?
      result["tipPointSpawnAbsolutePosition"] = true
      if @location.attached?
        result["tipPointSpawnAttached"] = true; result["tipPointSpawnSnappee"] = @location.snappee.id; result["tipPointSpawnSnapPoint"] = @location.snap_point
      else
        result["tipPointSpawnAttached"] = false; result["tipPointSpawnX"] = @location.x; result["tipPointSpawnY"] = @location.y
      end
    else
      result["tipPointSpawnAbsolutePosition"] = false; result["tipPointSpawnDistance"] = @distance || 100; result["tipPointSpawnAngle"] = @angle || Math::PI / 2
    end
    result["tipPointSpawnTimeBeats"] = time_in_beats?; result["tipPointSpawnTime"] = time_in_beats? ? SviberMacroHelpers.beat(@time_beats || 1) : (@time_seconds || 1); result
  end
end

class BpmChange
  def self.new(time, bpm) = ($sviber.timing["bpmChanges"] << { "time" => SviberMacroHelpers.beat(time), "bpm" => bpm.to_f }; wrap($sviber.timing["bpmChanges"].last))
  def self.wrap(raw) = (item = allocate; item.instance_variable_set(:@raw, raw); item)
  def self.list = $sviber.timing["bpmChanges"].map { |item| wrap(item) }
  def time = @raw["time"]
  def bpm = @raw["bpm"]
  def bpm=(value)
    @raw["bpm"] = value.to_f
  end
  def delete = $sviber.timing["bpmChanges"].delete(@raw)
end

class BarLine
  def self.new(time) = ($sviber.bar_lines << { "time" => SviberMacroHelpers.beat(time) }; wrap($sviber.bar_lines.last))
  def self.wrap(raw) = (item = allocate; item.instance_variable_set(:@raw, raw); item)
  def self.list = $sviber.bar_lines.map { |item| wrap(item) }
  def time = @raw["time"]
  def delete = $sviber.bar_lines.delete(@raw)
end

class Channel
  def self.new(name: nil, color: nil) = wrap($sviber.channel(name || "Channel", color: color))
  def self.wrap(raw) = raw && (item = allocate; item.instance_variable_set(:@raw, raw); item)
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
    @raw["color"] = SviberMacroHelpers.css_color(value)
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
  def delete = ($sviber.remove_channel(self); @raw["__deleted"] = true; self)
  def to_h = @raw
  def to_json(*args) = to_h.to_json(*args)
end

class Snappee
  TYPE_ALIASES = { rectangular_mesh: "rectangularMesh", radial_mesh: "radialMesh", parametric_mesh: "parametricMesh", regular_polygon_curve: "regularPolygonCurve", bezier_curve: "bezierCurve", pen_curve: "penCurve", parametric_curve: "parametricCurve" }.freeze
  def self.new(type = :rectangular_mesh, *args, **values)
    type = TYPE_ALIASES.fetch(type.to_sym, type.to_s)
    fields = case type
             when "rectangularMesh" then { "topLeftX" => args[0], "topLeftY" => args[1], "bottomRightX" => args[2], "bottomRightY" => args[3], "horizontalTiles" => args[4], "verticalTiles" => args[5] }
             when "radialMesh" then { "centerX" => args[0], "centerY" => args[1], "radius" => args[2], "azimuthalTiles" => args[3], "radialTiles" => args[4], "startingAngle" => args[5] }
             when "regularPolygonCurve" then { "centerX" => args[0], "centerY" => args[1], "radius" => args[2], "angle" => args[3], "sides" => args[4], "segmentsPerSide" => args[5] }
             when "bezierCurve" then { "degree" => args[0], "controlPoints" => args[1], "segments" => args[2] }
             when "parametricMesh" then { "iRange" => args[0], "jRange" => args[1], "xExpression" => args[2], "yExpression" => args[3] }
             when "parametricCurve" then { "iRange" => args[0], "xExpression" => args[1], "yExpression" => args[2] }
             else { "commands" => args[0], "segments" => args[1], "closed" => args[2] }
             end
    wrap($sviber.snappee(type, **fields.compact, **values))
  end
  def self.wrap(raw) = raw && (item = allocate; item.instance_variable_set(:@raw, raw); item)
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
    @raw["color"] = SviberMacroHelpers.css_color(value)
  end
  def active? = @raw["active"] != false
  def selected? = @raw["selected"] == true
  def activate = (@raw["active"] = true; self)
  def deactivate = (@raw["active"] = false; self)
  def select = (Snappee.deselect; @raw["selected"] = true; self)
  def pos(i = 0, j = 0)
    x = y = 0.0
    case @raw["type"]
    when "rectangularMesh"
      x = @raw.fetch("topLeftX", -100).to_f + i.to_f * (@raw.fetch("bottomRightX", 100).to_f - @raw.fetch("topLeftX", -100).to_f) / [@raw.fetch("horizontalTiles", 1).to_f, 1].max
      y = @raw.fetch("topLeftY", 50).to_f + j.to_f * (@raw.fetch("bottomRightY", -50).to_f - @raw.fetch("topLeftY", 50).to_f) / [@raw.fetch("verticalTiles", 1).to_f, 1].max
    when "radialMesh"
      angle = @raw.fetch("startingAngle", 0).to_f + i.to_f * Math::PI * 2 / [@raw.fetch("azimuthalTiles", 1).to_f, 1].max
      radius = @raw.fetch("radius", 50).to_f * j.to_f / [@raw.fetch("radialTiles", 1).to_f, 1].max
      x = @raw.fetch("centerX", 0).to_f + radius * Math.cos(angle); y = @raw.fetch("centerY", 0).to_f + radius * Math.sin(angle)
    when "regularPolygonCurve"
      sides = [@raw.fetch("sides", 3).to_i, 3].max; segments = [@raw.fetch("segmentsPerSide", 1).to_i, 1].max; index = i.to_i; side = index / segments; fraction = (index % segments).to_f / segments
      vertex = ->(n) { [@raw.fetch("centerX", 0).to_f + @raw.fetch("radius", 50).to_f * Math.cos(@raw.fetch("angle", 0).to_f + n * Math::PI * 2 / sides), @raw.fetch("centerY", 0).to_f + @raw.fetch("radius", 50).to_f * Math.sin(@raw.fetch("angle", 0).to_f + n * Math::PI * 2 / sides)] }
      a, b = vertex.call(side), vertex.call((side + 1) % sides); x = a[0] + (b[0] - a[0]) * fraction; y = a[1] + (b[1] - a[1]) * fraction
    else
      x = @raw.fetch("centerX", @raw.fetch("topLeftX", 0)).to_f; y = @raw.fetch("centerY", @raw.fetch("topLeftY", 0)).to_f
    end
    transform = @raw.fetch("transformation", [1, 0, 0, 1, 0, 0]); Vector2D.new(transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5])
  end
  def nearest_point(x, y)
    points = if @raw["type"] == "rectangularMesh"
               (0..@raw.fetch("horizontalTiles", 1).to_i).flat_map { |i| (0..@raw.fetch("verticalTiles", 1).to_i).map { |j| [i, j] } }
             else (0..[@raw.fetch("segments", @raw.fetch("segmentsPerSide", 16)).to_i, 1].max).map { |i| [i, 0] }
             end
    points.map { |point| p = pos(*point); { snap_point: point.length == 1 ? point[0] : point, x: p.x, y: p.y, distance: Math.hypot(p.x - x.to_f, p.y - y.to_f) } }.min_by { |hit| hit[:distance] }
  end
  def duplicate(name = self.name, color = self.color) = Snappee.wrap($sviber.snappee(@raw["type"], @raw.merge("id" => nil, "name" => name, "color" => color)))
  def move_up = reorder(-1)
  def move_down = reorder(1)
  def reorder(delta) = (index = $sviber.snappees.index(@raw); target = index + delta; $sviber.snappees[index], $sviber.snappees[target] = $sviber.snappees[target], $sviber.snappees[index] if index && target.between?(0, $sviber.snappees.length - 1); self)
  def delete = ($sviber.remove_snappee(self); @raw["__deleted"] = true; self)
  def to_h = @raw
  def to_json(*args) = to_h.to_json(*args)
end

%i[RectangularMesh RadialMesh ParametricMesh RegularPolygonCurve BezierCurve PenCurve ParametricCurve].each { |name| Object.const_set(name, Snappee) unless Object.const_defined?(name) }

class Event
  def self.wrap(raw) = raw && (item = allocate; item.instance_variable_set(:@raw, raw); item)
  def self.new(type: :tap, **values) = wrap($sviber.event(type.to_s, **values))
  def self.list = $sviber.raw_events.map { |item| wrap(item) }
  def self.selection = list.select(&:selected?)
  def ensure_alive
    raise "Event has been deleted" if @raw && @raw["__deleted"]
    true
  end
  def id = (ensure_alive; @raw["id"])
  def type = @raw["type"]
  def type=(value)
    ensure_alive; replacement = $sviber.event(value.to_s, @raw.merge("id" => @raw["id"])); $sviber.events.pop; @raw.replace(replacement)
  end
  def movable? = %w[tap hold drag flick bgNote group].include?(type)
  def have_time? = !@raw["time"].nil? || group?
  def have_channel? = type != "group" && !@raw["channel"].nil?
  def have_duration? = !@raw["duration"].nil?
  def have_text? = %w[tap hold flick bgNote bigText comment].include?(type)
  def tip_pointable? = %w[tap hold drag flick].include?(type)
  def group? = type == "group"
  def location
    raise "#{type} events do not have a location" unless movable?
    @raw["attached"] ? Location.new(Snappee.get_by_id(@raw["snappee"]), @raw["snapPoint"]) : Location.new(@raw["x"] || 0, @raw["y"] || 0)
  end
  def location=(value)
    raise "#{type} events do not have a location" unless movable?
    point = value.is_a?(Location) ? value : Location.new(value.x, value.y)
    before = location.pos
    if group?
      descendants = Event.list.select { |item| item.raw != @raw && Event.group_contains?(@raw, item.raw) }
      descendants.each { |item| next unless item.raw.key?("x"); item.raw["x"] = item.raw["x"].to_f + point.pos.x - before.x; item.raw["y"] = item.raw["y"].to_f + point.pos.y - before.y; item.raw["attached"] = false; item.raw.delete("snappee"); item.raw.delete("snapPoint") }
    end
    if point.attached?
      @raw["attached"] = true; @raw["snappee"] = point.snappee.id; @raw["snapPoint"] = point.snap_point; @raw.delete("x"); @raw.delete("y")
    else
      @raw["attached"] = false; @raw["x"] = point.x; @raw["y"] = point.y; @raw.delete("snappee"); @raw.delete("snapPoint")
    end
    self
  end
  def anchor = (raise("anchor is only valid for groups") unless group?; Location.new(@raw["x"] || 0, @raw["y"] || 0))
  def anchor=(value)
    raise "anchor is only valid for groups" unless group?
    point = value.is_a?(Location) ? value : Location.new(value.x, value.y); @raw["x"] = point.x; @raw["y"] = point.y; @raw["attached"] = false
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
    @raw["duration"] = SviberMacroHelpers.beat(value)
  end
  def time = group? ? self.class.group_time(@raw) : SviberMacroHelpers.rational(@raw["time"] || 0)
  def time=(value)
    group? ? translate_time(value) : (@raw["time"] = SviberMacroHelpers.beat(value))
  end
  def self.group_time(raw) = raw.fetch("events", []).map { |item| item["type"] == "group" ? group_time(item) : SviberMacroHelpers.rational(item["time"] || 0) }.min || Rational(0)
  def translate_time(value)
    delta = SviberMacroHelpers.rational(value) - self.class.group_time(@raw)
    Event.list.each { |item| item.raw["time"] = SviberMacroHelpers.beat(SviberMacroHelpers.rational(item.raw["time"]) + delta) if item.raw["time"] && self.class.group_contains?(@raw, item.raw) }
    self
  end
  def channel = (raise "groups do not have channels" if group?; Channel.get_by_id(@raw["channel"]))
  def channel=(value)
    raise "groups do not have channels" if group?; @raw["channel"] = value.id
  end
  def events = (raise "only groups have events" unless group?; @raw.fetch("events", []).map { |item| Event.wrap(item) })
  def color = (raise "only groups have colors" unless group?; @raw["color"])
  def color=(value)
    raise "only groups have colors" unless group?; @raw["color"] = SviberMacroHelpers.css_color(value)
  end
  def tip_point
    raise "event is not tip-pointable" unless tip_pointable?
    absolute = @raw["tipPointSpawnAbsolutePosition"]
    location = absolute ? (@raw["tipPointSpawnAttached"] ? Location.new(Snappee.get_by_id(@raw["tipPointSpawnSnappee"]), @raw["tipPointSpawnSnapPoint"]) : Location.new(@raw["tipPointSpawnX"], @raw["tipPointSpawnY"])) : nil
    TipPoint.new(@raw["tipPointSpawnType"] || "inherit", location: location, distance: absolute ? nil : @raw["tipPointSpawnDistance"], angle: absolute ? nil : @raw["tipPointSpawnAngle"], time_seconds: @raw["tipPointSpawnTimeBeats"] ? nil : @raw["tipPointSpawnTime"], time_beats: @raw["tipPointSpawnTimeBeats"] ? @raw["tipPointSpawnTime"] : nil)
  end
  def tip_point=(value)
    raise "event is not tip-pointable" unless tip_pointable?; @raw.keys.grep(/^tipPointSpawn/).each { |key| @raw.delete(key) }; @raw.merge!(value.to_h); self
  end
  def delete = ($sviber.remove_event(self); @raw["__deleted"] = true; self)
  def selected? = @raw["selected"] == true
  def raw = @raw
  def to_h = @raw
  def to_json(*args) = to_h.to_json(*args)
  def self.group_contains?(group, target)
    Array(group["events"]).any? { |child| child.equal?(target) || child["id"] == target["id"] || (child["type"] == "group" && group_contains?(child, target)) }
  end
end

class Clip
  def self.new(events, name = nil) = (raw = { "name" => name || "Clip #{$sviber.clips.length + 1}", "data" => { "events" => events.map { |item| item.respond_to?(:raw) ? item.raw : item } } }; $sviber.clips << raw; wrap(raw))
  def self.wrap(raw) = raw && (item = allocate; item.instance_variable_set(:@raw, raw); item)
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

module Chart
  class << self
    def current_time = $sviber.current_time
    def current_time=(value)
      $sviber.current_time = value
    end
    def channels = Channel.list
    def current_channel = Channel.current
    def snappees = Snappee.list
    def selected_snappee = Snappee.selected
    def clips = $sviber.clips.map { |item| Clip.wrap(item) }
    def events = Event.list
    def selected_events = Event.selection
    def offset = $sviber.timing["offset"] || 0
    def offset=(value)
      $sviber.timing["offset"] = value.to_f
    end
    def initial_bpm = $sviber.timing["initialBpm"] || 120
    def initial_bpm=(value)
      $sviber.timing["initialBpm"] = value.to_f
    end
    def bpm_changes = BpmChange.list
    def bar_lines = BarLine.list
  end
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
def b(value = nil) = value.nil? ? $sviber.current_time : $sviber.set_time($sviber.current_time + SviberMacroHelpers.rational(value))
def b!(value = nil) = value.nil? ? $sviber.current_time : $sviber.set_time(value)
def bpm(value) = (existing = $sviber.timing["bpmChanges"].find { |item| item["time"] == $sviber.current_time }; existing ? existing["bpm"] = value.to_f : $sviber.timing["bpmChanges"] << { "time" => $sviber.current_time, "bpm" => value.to_f }; value)
def g(values = nil, color = nil, &block)
  if block
    before = $sviber.raw_events.map { |item| item["id"] }
    block.call
    added = $sviber.raw_events.reject { |item| before.include?(item["id"]) }
    return Event.wrap($sviber.event("group", "events" => added.map { |item| item }, "color" => color))
  end
  Event.wrap($sviber.event("group", "events" => Array(values).map { |item| item.is_a?(Hash) ? item : item.to_h }, "color" => color))
end
def copy(values = $sviber.selected) = $sviber.copy(values).map { |item| Event.wrap(item) }
def transform(things, matrix = nil, &block) = $sviber.transform(things, matrix, &block)
def log(*values) = $stdout.puts(*values)
def l(*args) = Location.new(*args)
def c(name) = (Channel.get(name) || Channel.new(name: name)).select
def s(value = 0) = Snappee.get(value)
def tpc(distance_or_location, angle_or_time = nil, time = nil)
  distance_or_location.is_a?(Location) ? TipPoint.chain(location: distance_or_location, **(angle_or_time.is_a?(Float) ? { time_seconds: angle_or_time } : { time_beats: angle_or_time })) : TipPoint.chain(distance: distance_or_location, angle: angle_or_time, **(time.is_a?(Float) ? { time_seconds: time } : { time_beats: time }))
end
def tpd(distance_or_location, angle_or_time = nil, time = nil)
  distance_or_location.is_a?(Location) ? TipPoint.drop(location: distance_or_location, **(angle_or_time.is_a?(Float) ? { time_seconds: angle_or_time } : { time_beats: angle_or_time })) : TipPoint.drop(distance: distance_or_location, angle: angle_or_time, **(time.is_a?(Float) ? { time_seconds: time } : { time_beats: time }))
end
def big_text(duration, text = "") = $sviber.event("bigText", "duration" => duration, "text" => text)
def grid(duration) = $sviber.event("grid", "duration" => duration)
def diamond_grid(duration) = $sviber.event("diamondGrid", "duration" => duration)
def hexagon(duration) = $sviber.event("hexagon", "duration" => duration)
