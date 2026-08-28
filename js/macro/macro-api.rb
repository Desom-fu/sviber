# frozen_string_literal: true

require "json"
require "base64"

class Vector2D
  attr_accessor :x, :y

  def initialize(x = 0, y = 0)
    @x = x.to_f
    @y = y.to_f
  end

  def +(other) = Vector2D.new(@x + other.x, @y + other.y)
  def -(other) = Vector2D.new(@x - other.x, @y - other.y)
  def *(value) = Vector2D.new(@x * value.to_f, @y * value.to_f)
  def /(value) = Vector2D.new(@x / value.to_f, @y / value.to_f)
  def to_ary = [@x, @y]
end

class Location
  def initialize(*args)
    if args.first.is_a?(Snappee)
      @snappee = args.first
      raw = SviberMacroInternals.ensure_alive(@snappee, "Snappee")
      @snap_point = SviberMacroInternals.checked_snap_point(raw, args.drop(1))
      point = @snappee.pos(*Array(@snap_point))
      @x, @y = point.x, point.y
    elsif args.length == 2
      raise TypeError, "Location coordinates must be numbers" unless args.all? { |value| value.is_a?(Numeric) }
      @x, @y = args.map(&:to_f)
      @snappee = nil
      @snap_point = nil
    else
      raise ArgumentError, "Location.new expects (x, y), (curve, i), or (mesh, i, j)"
    end
  end

  def pos
    return Vector2D.new(@x, @y) unless attached?
    @snappee.pos(*Array(@snap_point))
  end

  def attached? = !@snappee.nil?

  def attach
    point = pos
    nearest = Snappee.list.select(&:active?).filter_map do |item|
      raw = SviberMacroInternals.ensure_alive(item, "Snappee")
      snap_point = SviberMacroInternals.nearest_snap_point(raw, point.x, point.y)
      position = item.pos(*Array(snap_point))
      [Math.hypot(position.x - point.x, position.y - point.y), item, snap_point]
    end.min_by(&:first)
    if nearest
      @snappee = nearest[1]
      @snap_point = nearest[2]
    end
    self
  end

  def detach
    point = pos
    @snappee = nil
    @snap_point = nil
    @x, @y = point.x, point.y
    self
  end

  def snappee = @snappee

  def snappee=(value)
    if value.nil?
      detach
    else
      raise TypeError, "snappee must be a Snappee" unless value.is_a?(Snappee)
      point = pos
      raw = SviberMacroInternals.ensure_alive(value, "Snappee")
      @snappee = value
      @snap_point = SviberMacroInternals.nearest_snap_point(raw, point.x, point.y)
    end
    value
  end

  def x = pos.x
  def y = pos.y

  def x=(value)
    detach
    @x = value.to_f
  end

  def y=(value)
    detach
    @y = value.to_f
  end
end

class TipPoint
  def self.inherit = new(:inherit)
  def self.none = new(:none)

  def self.chain(distance: nil, angle: nil, location: nil, time_seconds: nil, time_beats: nil)
    new(:chain, distance: distance, angle: angle, location: location, time_seconds: time_seconds, time_beats: time_beats)
  end

  def self.drop(distance: nil, angle: nil, location: nil, time_seconds: nil, time_beats: nil)
    new(:drop, distance: distance, angle: angle, location: location, time_seconds: time_seconds, time_beats: time_beats)
  end

  def initialize(type, distance: nil, angle: nil, location: nil, time_seconds: nil, time_beats: nil)
    raise ArgumentError, "distance and angle are incompatible with location" if location && (!distance.nil? || !angle.nil?)
    raise ArgumentError, "time_seconds is incompatible with time_beats" if !time_seconds.nil? && !time_beats.nil?
    raise TypeError, "location must be a Location" if location && !location.is_a?(Location)
    raise TypeError, "distance must be numeric" if distance && !distance.is_a?(Numeric)
    raise TypeError, "time_seconds must be numeric" if time_seconds && !time_seconds.is_a?(Numeric)
    @type = type.to_sym
    @distance = distance&.to_f
    @angle = angle.nil? ? nil : SviberMacroInternals.angle(angle)
    @location = location
    @time_seconds = time_seconds&.to_f
    @time_beats = time_beats.nil? ? nil : SviberMacroInternals.rational(time_beats)
  end

  def absolute? = !@location.nil?
  def relative? = !absolute?
  def time_in_seconds? = !@time_seconds.nil?
  def time_in_beats? = !time_in_seconds?
  attr_reader :distance, :angle, :location, :time_seconds, :time_beats

  def distance=(value)
    raise TypeError, "distance must be numeric" if value && !value.is_a?(Numeric)
    @distance = value.nil? ? nil : value.to_f
    @location = nil unless value.nil?
  end

  def angle=(value)
    @angle = value.nil? ? nil : SviberMacroInternals.angle(value)
    @location = nil unless value.nil?
  end

  def location=(value)
    raise TypeError, "location must be a Location" if value && !value.is_a?(Location)
    @location = value
    @distance = @angle = nil if value
  end

  def time_seconds=(value)
    raise TypeError, "time_seconds must be numeric" if value && !value.is_a?(Numeric)
    @time_seconds = value.nil? ? nil : value.to_f
    @time_beats = nil unless value.nil?
  end

  def time_beats=(value)
    @time_beats = value.nil? ? nil : SviberMacroInternals.rational(value)
    @time_seconds = nil unless value.nil?
  end
end

class BpmChange
  class << self
    def new(time, bpm)
      raw = { "time" => SviberMacroInternals.beat(time), "bpm" => bpm.to_f }
      SviberMacroInternals.timing["bpmChanges"] << raw
      wrap(raw)
    end

    def wrap(raw)
      return nil unless raw
      allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
    end

    def list = SviberMacroInternals.timing["bpmChanges"].map { |raw| wrap(raw) }
  end

  def time = SviberMacroInternals.rational_data(record["time"])
  def bpm = record["bpm"]
  def bpm=(value)
    record["bpm"] = value.to_f
  end

  def delete
    raw = record
    SviberMacroInternals.timing["bpmChanges"].delete(raw)
    raw["__deleted"] = true
    self
  end

  private

  def record = SviberMacroInternals.ensure_alive(self, "BpmChange")
end

class BarLine
  class << self
    def new(time)
      raw = { "time" => SviberMacroInternals.beat(time) }
      SviberMacroInternals.timing["barLines"] << raw
      wrap(raw)
    end

    def wrap(raw)
      return nil unless raw
      allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
    end

    def list = SviberMacroInternals.timing["barLines"].map { |raw| wrap(raw) }
  end

  def time = SviberMacroInternals.rational_data(record["time"])

  def delete
    raw = record
    SviberMacroInternals.timing["barLines"].delete(raw)
    raw["__deleted"] = true
    self
  end

  private

  def record = SviberMacroInternals.ensure_alive(self, "BarLine")
end

class Channel
  class << self
    def new(name: nil, color: nil) = wrap(SviberMacroInternals.add_channel(name: name, color: color))

    def wrap(raw)
      return nil unless raw
      allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
    end

    def get(value)
      raise TypeError, "channel number must be an Integer or name" unless value.is_a?(Integer) || value.is_a?(String)
      raw = if value.is_a?(String)
              SviberMacroInternals.channels.find { |item| item["name"] == value }
            elsif value.positive?
              SviberMacroInternals.channels[value - 1]
            end
      wrap(raw)
    end

    def get_by_id(id) = wrap(SviberMacroInternals.find("channel", id))
    def current = get_by_id(SviberMacroInternals.editor["currentChannel"])
    def list = SviberMacroInternals.channels.map { |raw| wrap(raw) }
  end

  def id = record["id"]
  def name = record["name"]
  def name=(value)
    record["name"] = value.to_s
  end
  def color = record.fetch("color", "#7f7f7f")
  def color=(value)
    record["color"] = SviberMacroInternals.css_color(value)
  end
  def active? = record["active"] != false
  def current? = SviberMacroInternals.editor["currentChannel"] == id

  def activate
    record["active"] = true
    self
  end

  def deactivate
    record["active"] = false
    self
  end

  def select
    SviberMacroInternals.editor["currentChannel"] = id
    self
  end

  def move_up = reorder(-1)
  def move_down = reorder(1)

  def events
    channel_id = id
    SviberMacroInternals.events.filter { |item| item["type"] != "group" && item["channel"] == channel_id }.map { |item| Event.wrap(item) }
  end

  def delete
    raw = record
    SviberMacroInternals.channels.delete(raw)
    raw["__deleted"] = true
    self
  end

  def to_h = SviberMacroInternals.deep_copy(record)
  def to_json(*args) = to_h.to_json(*args)

  private

  def record = SviberMacroInternals.ensure_alive(self, "Channel")

  def reorder(delta)
    raw = record
    index = SviberMacroInternals.channels.index(raw)
    target = index + delta
    if target.between?(0, SviberMacroInternals.channels.length - 1)
      SviberMacroInternals.channels[index], SviberMacroInternals.channels[target] = SviberMacroInternals.channels[target], SviberMacroInternals.channels[index]
    end
    self
  end
end


class AffineMatrix2D
  attr_accessor :a, :b, :c, :d, :tx, :ty

  def initialize(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0)
    @a, @b, @c, @d, @tx, @ty = [a, b, c, d, tx, ty].map(&:to_f)
  end

  def translate(x, y = nil)
    point = x.is_a?(Vector2D) ? x : Vector2D.new(x, y)
    @tx += point.x
    @ty += point.y
    self
  end

  def scale(x_scale, y_scale = x_scale)
    @a *= x_scale.to_f
    @b *= x_scale.to_f
    @c *= y_scale.to_f
    @d *= y_scale.to_f
    self
  end

  def rotate(angle)
    radians = SviberMacroInternals.angle(angle)
    compose(AffineMatrix2D.new(Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians)))
  end

  def horizontal_flip = scale(-1, 1)
  alias flip_horizontally horizontal_flip
  def vertical_flip = scale(1, -1)
  alias flip_vertically vertical_flip

  def compose(matrix)
    left = [@a, @b, @c, @d, @tx, @ty]
    right = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]
    @a = left[0] * right[0] + left[2] * right[1]
    @b = left[1] * right[0] + left[3] * right[1]
    @c = left[0] * right[2] + left[2] * right[3]
    @d = left[1] * right[2] + left[3] * right[3]
    @tx = left[0] * right[4] + left[2] * right[5] + left[4]
    @ty = left[1] * right[4] + left[3] * right[5] + left[5]
    self
  end
end

module SviberMacroInternals
  MISSING = Object.new.freeze
  EVENT_TYPES = %w[tap hold drag flick bgNote bigText grid hexagon checkerboard diamondGrid pentagon turntable hexagram comment group].freeze
  MOVABLE_TYPES = %w[tap hold drag flick bgNote group].freeze
  DURATION_TYPES = %w[hold bgNote bigText grid hexagon checkerboard diamondGrid pentagon turntable hexagram comment].freeze
  TEXT_TYPES = %w[tap hold flick bgNote bigText comment].freeze
  TIP_POINTABLE_TYPES = %w[tap hold drag flick].freeze
  POSITION_FIELDS = %w[attached x y snappee snapPoint].freeze
  TIP_POINT_FIELDS = %w[tipPointSpawnType tipPointSpawnAbsolutePosition tipPointSpawnAttached tipPointSpawnX tipPointSpawnY tipPointSpawnSnappee tipPointSpawnSnapPoint tipPointSpawnDistance tipPointSpawnAngle tipPointSpawnTimeBeats tipPointSpawnTime].freeze
  TYPE_NAMES = {
    bg_note: "bgNote", big_text: "bigText", diamond_grid: "diamondGrid",
    rectangular_mesh: "rectangularMesh", radial_mesh: "radialMesh", parametric_mesh: "parametricMesh",
    regular_polygon_curve: "regularPolygonCurve", bezier_curve: "bezierCurve", pen_curve: "penCurve",
    parametric_curve: "parametricCurve"
  }.freeze
  RUBY_EVENT_TYPES = EVENT_TYPES.to_h { |type| [type, type.gsub(/([A-Z])/, '_\\1').downcase.to_sym] }.freeze
  ANGLES = {
    u: Math::PI / 2, up: Math::PI / 2, d: -Math::PI / 2, down: -Math::PI / 2,
    l: Math::PI, left: Math::PI, r: 0.0, right: 0.0,
    ul: 3 * Math::PI / 4, lu: 3 * Math::PI / 4, up_left: 3 * Math::PI / 4, left_up: 3 * Math::PI / 4,
    ur: Math::PI / 4, ru: Math::PI / 4, up_right: Math::PI / 4, right_up: Math::PI / 4,
    dl: -3 * Math::PI / 4, ld: -3 * Math::PI / 4, down_left: -3 * Math::PI / 4, left_down: -3 * Math::PI / 4,
    dr: -Math::PI / 4, rd: -Math::PI / 4, down_right: -Math::PI / 4, right_down: -Math::PI / 4
  }.freeze
  MESH_SNAPPEE_TYPES = %w[rectangularMesh radialMesh parametricMesh].freeze
  CURVE_SNAPPEE_TYPES = %w[regularPolygonCurve bezierCurve circularArcCurve penCurve parametricCurve].freeze

  class MathExpression
    FUNCTIONS = {
      "abs" => ->(value) { value.abs }, "acos" => ->(value) { Math.acos(value) },
      "asin" => ->(value) { Math.asin(value) }, "atan" => ->(value) { Math.atan(value) },
      "atan2" => ->(y, x) { Math.atan2(y, x) }, "ceil" => ->(value) { value.ceil },
      "cos" => ->(value) { Math.cos(value) }, "exp" => ->(value) { Math.exp(value) },
      "floor" => ->(value) { value.floor }, "hypot" => ->(*values) { Math.hypot(*values) },
      "ln" => ->(value) { Math.log(value) }, "log" => ->(value, base = Math::E) { Math.log(value, base) },
      "log10" => ->(value) { Math.log10(value) }, "max" => ->(*values) { values.max },
      "min" => ->(*values) { values.min }, "pow" => ->(left, right) { left**right },
      "round" => ->(value, digits = 0) { value.round(digits.to_i) }, "sign" => ->(value) { value <=> 0 },
      "sin" => ->(value) { Math.sin(value) }, "sqrt" => ->(value) { Math.sqrt(value) },
      "tan" => ->(value) { Math.tan(value) }, "trunc" => ->(value) { value.truncate }
    }.freeze
    CONSTANTS = { "pi" => Math::PI, "e" => Math::E, "tau" => Math::PI * 2 }.freeze
    TOKEN = /\G\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?|([A-Za-z_]\w*)|(\*\*|[+\-*\/%^(),]))/

    def initialize(source, scope)
      @tokens = []
      @scope = scope.transform_keys(&:to_s)
      position = 0
      while position < source.length
        match = TOKEN.match(source, position)
        break if !match || match.begin(0) != position
        number = match[1] && (match[2] ? "#{match[1]}e#{match[2]}" : match[1])
        @tokens << (number ? [:number, number.to_f] : match[3] ? [:name, match[3]] : [match[4], match[4]])
        position = match.end(0)
      end
      raise ArgumentError, "invalid parametric expression" unless source[position..].to_s.strip.empty?
      @index = 0
    end

    def evaluate
      value = addition
      raise ArgumentError, "invalid parametric expression" if current
      number = Float(value)
      raise TypeError, "parametric expression must produce a finite number" unless number.finite?
      number
    end

    private

    def current = @tokens[@index]

    def accept(value)
      return false unless current&.first == value
      @index += 1
      true
    end

    def expect(value) = (accept(value) || raise(ArgumentError, "invalid parametric expression"))

    def addition
      value = multiplication
      loop do
        if accept("+")
          value += multiplication
        elsif accept("-")
          value -= multiplication
        else
          break
        end
      end
      value
    end

    def multiplication
      value = power
      loop do
        if accept("*")
          value *= power
        elsif accept("/")
          value /= power
        elsif accept("%")
          value %= power
        else
          break
        end
      end
      value
    end

    def power
      value = unary
      value **= power if accept("^") || accept("**")
      value
    end

    def unary
      return unary if accept("+")
      return -unary if accept("-")
      primary
    end

    def primary
      token = current || raise(ArgumentError, "invalid parametric expression")
      if accept(:number)
        token[1]
      elsif accept(:name)
        name = token[1]
        unless current&.first == "("
          return @scope.fetch(name) { CONSTANTS.fetch(name) { raise ArgumentError, "unknown math name: #{name}" } }
        end
        expect("(")
        arguments = []
        unless accept(")")
          loop do
            arguments << addition
            break if accept(")")
            expect(",")
          end
        end
        FUNCTIONS.fetch(name) { raise ArgumentError, "unknown math function: #{name}" }.call(*arguments)
      elsif accept("(")
        value = addition
        expect(")")
        value
      else
        raise ArgumentError, "invalid parametric expression"
      end
    end
  end

  class Output
    def initialize(kind, records)
      @kind = kind
      @records = records
      @buffer = +""
    end

    def write(value)
      @buffer << value.to_s
      while (newline = @buffer.index("\n"))
        @records << { "kind" => @kind, "value" => @buffer.slice!(0..newline).sub(/\r?\n\z/, "") }
      end
      value.to_s.bytesize
    end

    def print(*values) = (values.each { |value| write(value) }; nil)

    def puts(*values)
      values = [""] if values.empty?
      values.each do |value|
        if value.is_a?(Array)
          value.each { |item| puts(item) }
        else
          write(value.to_s)
          write("\n") unless value.to_s.end_with?("\n")
        end
      end
      nil
    end

    def <<(value) = (write(value); self)
    def flush = self
    def sync = true
    def sync=(_value)
      nil
    end
    def tty? = false
  end

  class << self
    attr_reader :state

    def load_json(source)
      @state = source.is_a?(String) ? JSON.parse(source) : deep_copy(source)
      @state = {} unless @state.is_a?(Hash)
      @state["metadata"] ||= {}
      @state["editor"] ||= {}
      @state["timing"] ||= {}
      @state["timing"]["offset"] ||= 0
      @state["timing"]["initialBpm"] ||= 120
      @state["timing"]["bpmChanges"] ||= []
      @state["timing"]["barLines"] ||= []
      @state["channels"] ||= []
      @state["events"] ||= []
      @state["snappees"] ||= []
      @state["clips"] ||= []
      @state["nextIds"] ||= {}
      @state
    end

    def deep_copy(value) = JSON.parse(JSON.generate(value))

    def angle(value)
      return ANGLES[value] if value.is_a?(Symbol) && ANGLES.key?(value)
      raise TypeError, "angle must be a number or direction symbol" unless value.is_a?(Numeric)
      value.to_f
    end

    def rational(value)
      return Rational(value, 1) if value.is_a?(Integer)
      return value if value.is_a?(Rational)
      raise TypeError, "beat must be Integer or Rational"
    end

    def rational_data(value)
      return rational(value) if value.is_a?(Integer) || value.is_a?(Rational)
      if value.is_a?(Array) && value.length == 3
        return Rational(value[0].to_i * value[2].to_i + value[1].to_i, value[2].to_i)
      end
      raise TypeError, "invalid stored beat"
    end

    def beat(value) = beat_from_rational(rational(value))
    def normalize_beat(value) = beat_from_rational(rational_data(value))

    def beat_from_rational(number)
      numerator = number.numerator
      denominator = number.denominator
      whole = numerator.negative? ? -(numerator.abs / denominator) : numerator / denominator
      [whole, numerator - whole * denominator, denominator]
    end

    def css_color(value)
      return format("#%06x", value) if value.is_a?(Integer) && value.between?(0, 0xffffff)
      raise TypeError, "color must be a CSS color string or hex integer" unless value.is_a?(String)
      text = value.strip.downcase
      return text.gsub(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, '#\\1\\1\\2\\2\\3\\3') if text.match?(/\A#[0-9a-f]{3}\z/)
      if (match = text.match(/\Argba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/))
        return "#%02x%02x%02x" % match.captures.map { |part| part.to_f.round.clamp(0, 255) }
      end
      { "red" => "#ff0000", "green" => "#008000", "blue" => "#0000ff", "white" => "#ffffff",
        "black" => "#000000", "yellow" => "#ffff00", "magenta" => "#ff00ff", "cyan" => "#00ffff",
        "transparent" => "#00000000", "rebeccapurple" => "#663399" }.fetch(text, text)
    end

    def type_name(value)
      key = value.respond_to?(:to_sym) ? value.to_sym : value
      TYPE_NAMES.fetch(key, value.to_s)
    end

    def camel_key(value)
      text = value.to_s
      text.gsub(/_([a-z])/) { Regexp.last_match(1).upcase }
    end

    def stringify_keys(value)
      case value
      when Hash then value.to_h { |key, item| [camel_key(key), stringify_keys(item)] }
      when Array then value.map { |item| stringify_keys(item) }
      else value
      end
    end

    def raw(value)
      value.instance_variable_defined?(:@raw) ? value.instance_variable_get(:@raw) : value
    end

    def ensure_alive(value, kind)
      item = raw(value)
      raise RuntimeError, "#{kind} has been deleted" if !item.is_a?(Hash) || item["__deleted"]
      item
    end

    def channels = @state.fetch("channels")
    def events = @state.fetch("events")
    def snappees = @state.fetch("snappees")
    def clips = @state.fetch("clips")
    def timing = @state.fetch("timing")
    def editor = @state.fetch("editor")

    def all_events(items = events, result = [])
      items.each do |item|
        result << item
        all_events(item.fetch("events", []), result) if item["type"] == "group"
      end
      result
    end

    def descendants(item) = all_events(item.fetch("events", []), [])

    def next_id(kind)
      items = kind == "event" ? all_events : @state.fetch("#{kind}s")
      stored = @state["nextIds"][kind].to_i
      value = [items.filter_map { |item| item["id"] if item["id"].is_a?(Integer) }.max.to_i + 1, stored].max
      value = 0 if items.empty? && stored.zero?
      @state["nextIds"][kind] = value + 1
      value
    end

    def find(kind, id)
      collection = kind == "event" ? all_events : @state.fetch("#{kind}s")
      collection.find { |item| item["id"] == id.to_i }
    end

    def location_fields(location, prefix = "")
      raise TypeError, "location must be a Location" unless location.is_a?(Location)
      attached = location.attached?
      fields = { "#{prefix}attached" => attached }
      if attached
        fields["#{prefix}snappee"] = location.snappee.id
        fields["#{prefix}snapPoint"] = deep_copy(location.instance_variable_get(:@snap_point))
      else
        fields["#{prefix}x"] = location.x
        fields["#{prefix}y"] = location.y
      end
      fields
    end

    def assign_location(item, location)
      POSITION_FIELDS.each { |field| item.delete(field) }
      item.merge!(location_fields(location))
    end

    def tip_point_fields(tip_point)
      raise TypeError, "tip_point must be a TipPoint" unless tip_point.is_a?(TipPoint)
      absolute = tip_point.absolute?
      result = { "tipPointSpawnType" => tip_point.instance_variable_get(:@type).to_s,
                 "tipPointSpawnAbsolutePosition" => absolute }
      if absolute
        location_fields(tip_point.location, "tipPointSpawn").each do |key, value|
          result[key.sub("tipPointSpawnattached", "tipPointSpawnAttached")
                    .sub("tipPointSpawnsnappee", "tipPointSpawnSnappee")
                    .sub("tipPointSpawnsnapPoint", "tipPointSpawnSnapPoint")
                    .sub("tipPointSpawnx", "tipPointSpawnX")
                    .sub("tipPointSpawny", "tipPointSpawnY")] = value
        end
      else
        result["tipPointSpawnDistance"] = tip_point.distance || 100
        result["tipPointSpawnAngle"] = tip_point.angle || Math::PI / 2
      end
      result["tipPointSpawnTimeBeats"] = tip_point.time_in_beats?
      result["tipPointSpawnTime"] = tip_point.time_in_beats? ? beat(tip_point.time_beats || 1) : (tip_point.time_seconds || 1).to_f
      result
    end

    def add_event(type, values = {})
      type = type_name(type)
      raise TypeError, "Unsupported event type: #{type}" unless EVENT_TYPES.include?(type)
      values = stringify_keys(values)
      values.delete("type")
      location = values.delete("location")
      tip_point = values.delete("tipPoint")
      prepare_child = lambda do |child|
        item = raw(child)
        item["id"] = next_id("event") if item["id"].nil?
        item["events"] = item.fetch("events", []).map { |nested| prepare_child.call(nested) } if item["type"] == "group"
        item
      end
      children = Array(values.delete("events")).map { |item| prepare_child.call(item) }
      item = {
        "type" => type,
        "channel" => editor.fetch("currentChannel", channels.first&.fetch("id", 0) || 0),
        "time" => normalize_beat(editor.fetch("currentTime", [0, 0, 1])), "selected" => true
      }.merge(values)
      item["id"] = next_id("event")
      item["channel"] = raw(values["channel"])["id"] if values["channel"].is_a?(Channel)
      item["time"] = normalize_beat(values["time"]) if values.key?("time")
      item["duration"] = normalize_beat(values["duration"]) if values.key?("duration")
      item["angle"] = angle(values["angle"]) if values.key?("angle")
      item["color"] = css_color(values["color"]) if values.key?("color")
      assign_location(item, location) if location
      item.merge!(tip_point_fields(tip_point)) if tip_point

      unless MOVABLE_TYPES.include?(type)
        POSITION_FIELDS.each { |field| item.delete(field) }
      else
        item["attached"] = !!item["attached"]
        if item["attached"]
          item["snapPoint"] ||= 0
          item.delete("x"); item.delete("y")
        else
          item["x"] = item.fetch("x", 0).to_f
          item["y"] = item.fetch("y", 0).to_f
          item.delete("snappee"); item.delete("snapPoint")
        end
      end
      if DURATION_TYPES.include?(type)
        item["duration"] = normalize_beat(item.fetch("duration", %w[bgNote comment].include?(type) ? 0 : 1))
      else
        item.delete("duration")
      end
      TEXT_TYPES.include?(type) ? item["text"] = item.fetch("text", "").to_s : item.delete("text")
      type == "flick" ? item["angle"] = angle(item.fetch("angle", Math::PI / 2)) : item.delete("angle")
      if TIP_POINTABLE_TYPES.include?(type)
        item["tipPointSpawnType"] ||= "inherit"
        item["tipPointSpawnAbsolutePosition"] = !!item["tipPointSpawnAbsolutePosition"]
        item["tipPointSpawnTimeBeats"] = !!item["tipPointSpawnTimeBeats"]
        item["tipPointSpawnTime"] = item["tipPointSpawnTimeBeats"] ? normalize_beat(item.fetch("tipPointSpawnTime", 1)) : item.fetch("tipPointSpawnTime", 1).to_f
        if item["tipPointSpawnAbsolutePosition"]
          item.delete("tipPointSpawnDistance"); item.delete("tipPointSpawnAngle")
        else
          item["tipPointSpawnDistance"] = item.fetch("tipPointSpawnDistance", 100).to_f
          item["tipPointSpawnAngle"] = angle(item.fetch("tipPointSpawnAngle", Math::PI / 2))
          %w[tipPointSpawnAttached tipPointSpawnX tipPointSpawnY tipPointSpawnSnappee tipPointSpawnSnapPoint].each { |field| item.delete(field) }
        end
      else
        TIP_POINT_FIELDS.each { |field| item.delete(field) }
      end
      if type == "group"
        item["events"] = children
        item["color"] = css_color(item.fetch("color", "#ff9d3d"))
        item.delete("time"); item.delete("channel")
      else
        item.delete("events"); item.delete("color")
      end
      children.each { |child| detach_event(child) } if type == "group"
      events << item
      item
    end

    def add_channel(name: nil, color: nil)
      ordinal = channels.length + 1
      item = { "id" => next_id("channel"), "name" => (name || "Channel #{ordinal}").to_s,
               "color" => css_color(color || "#7f7f7f"), "active" => true }
      channels << item
      item
    end

    def add_snappee(type, fields)
      type = type_name(type)
      count = snappees.count { |item| item["type"] == type } + 1
      values = stringify_keys(fields)
      item = { "id" => next_id("snappee"), "type" => type, "name" => "#{type} #{count}",
               "color" => "#7f7f7f", "active" => true, "selected" => false,
               "transformation" => [1, 0, 0, 1, 0, 0] }.merge(values)
      item["name"] = item["name"].to_s
      item["color"] = css_color(item["color"])
      snappees << item
      item
    end

    def remove_event(target, items = events)
      index = items.index(target)
      return items.delete_at(index) if index
      items.each do |item|
        removed = remove_event(target, item.fetch("events", [])) if item["type"] == "group"
        return removed if removed
      end
      nil
    end

    def detach_event(target) = remove_event(target)

    def event_time(item)
      return rational_data(item.fetch("time", [0, 0, 1])) unless item["type"] == "group"
      descendants(item).filter_map { |child| rational_data(child["time"]) if child["type"] != "group" && child["time"] }.min || Rational(0)
    end

    def event_channels(item)
      (item["type"] == "group" ? descendants(item) : [item]).select { |child| child["type"] != "group" && child["channel"] }
    end

    def shifted_copies(values, time, channel)
      sources = values.map { |value| ensure_alive(value, "Event") }
      return [] if sources.empty?
      origin = sources.map { |item| event_time(item) }.min
      source_indices = sources.flat_map { |item| event_channels(item) }.map do |item|
        index = channels.index { |candidate| candidate["id"] == item["channel"] }
        raise RuntimeError, "event refers to a channel that does not exist" unless index
        index
      end
      minimum = source_indices.min || 0
      maximum = source_indices.max || minimum
      target_index = channels.index { |candidate| candidate["id"] == channel.id }
      raise RuntimeError, "paste channel does not exist" unless target_index
      Channel.new while target_index + maximum - minimum >= channels.length
      shift = lambda do |source|
        copy = deep_copy(source)
        copy["id"] = nil
        copy["time"] = beat_from_rational(rational(time) + rational_data(copy["time"]) - origin) if copy["time"]
        if copy["channel"]
          source_index = channels.index { |candidate| candidate["id"] == copy["channel"] }
          copy["channel"] = channels[target_index + source_index - minimum]["id"]
        end
        copy["events"] = copy.fetch("events", []).map { |child| shift.call(child) } if copy["type"] == "group"
        copy
      end
      sources.map { |source| Event.wrap(add_event(source["type"], shift.call(source))) }
    end

    def clip_data_for(values)
      sources = values.map { |value| ensure_alive(value, "Event") }
      return { "version" => 1, "events" => [], "channels" => [], "snappees" => [] } if sources.empty?
      leaves = sources.flat_map { |item| item["type"] == "group" ? descendants(item) : [item] }.reject { |item| item["type"] == "group" }
      channel_indices = leaves.map { |item| channels.index { |candidate| candidate["id"] == item["channel"] } }
      raise RuntimeError, "event refers to a channel that does not exist" if channel_indices.any?(&:nil?)
      minimum = channel_indices.min || 0
      maximum = channel_indices.max || minimum
      origin = sources.map { |item| event_time(item) }.min
      normalize = lambda do |source|
        copy = deep_copy(source)
        copy["id"] = nil
        if copy["type"] == "group"
          copy["events"] = copy.fetch("events", []).map { |child| normalize.call(child) }
        else
          copy["time"] = beat_from_rational(rational_data(copy["time"]) - origin)
          copy["channel"] = channels.index { |candidate| candidate["id"] == copy["channel"] } - minimum
        end
        copy
      end
      snappee_ids = leaves.flat_map { |item| [item["snappee"], item["tipPointSpawnSnappee"]] }.compact.uniq
      {
        "version" => 1,
        "events" => sources.map { |source| normalize.call(source) },
        "channels" => channels[minimum..maximum].to_a.each_with_index.map { |item, index| deep_copy(item).merge("channelOffset" => index) },
        "snappees" => snappees.select { |item| snappee_ids.include?(item["id"]) }.map { |item| deep_copy(item) }
      }
    end

    def paste_clip_data(data, time, channel)
      sources = data.is_a?(Hash) && data["events"].is_a?(Array) ? data["events"] : []
      return [] if sources.empty?
      target_index = channels.index { |candidate| candidate["id"] == channel.id }
      raise RuntimeError, "paste channel does not exist" unless target_index
      leaves = sources.flat_map { |item| item["type"] == "group" ? descendants(item) : [item] }.reject { |item| item["type"] == "group" }
      offsets = leaves.map { |item| item["channel"] }
      unless offsets.all? { |value| value.is_a?(Integer) && value >= 0 }
        raise TypeError, "clip channel offsets must be nonnegative integers"
      end
      maximum = offsets.max || 0
      Channel.new while target_index + maximum >= channels.length
      shift = lambda do |source|
        copy = deep_copy(source)
        copy["id"] = nil
        if copy["type"] == "group"
          copy["events"] = copy.fetch("events", []).map { |child| shift.call(child) }
        else
          copy["time"] = beat_from_rational(rational(time) + rational_data(copy["time"]))
          copy["channel"] = channels[target_index + copy["channel"]]["id"]
        end
        copy
      end
      sources.map { |source| Event.wrap(add_event(source["type"], shift.call(source))) }
    end

    def snap_point_position(item, point)
      values = point.is_a?(Array) ? point : [point]
      i, j = values.fetch(0, 0).to_f, values.fetch(1, 0).to_f
      x = y = 0.0
      case item["type"]
      when "rectangularMesh"
        x = item.fetch("topLeftX", -100).to_f + i * (item.fetch("bottomRightX", 100).to_f - item.fetch("topLeftX", -100).to_f) / [item.fetch("horizontalTiles", 1).to_f, 1].max
        y = item.fetch("topLeftY", 50).to_f + j * (item.fetch("bottomRightY", -50).to_f - item.fetch("topLeftY", 50).to_f) / [item.fetch("verticalTiles", 1).to_f, 1].max
      when "radialMesh"
        theta = item.fetch("startingAngle", 0).to_f + i * Math::PI * 2 / [item.fetch("azimuthalTiles", 1).to_f, 1].max
        radius = item.fetch("radius", 50).to_f * j / [item.fetch("radialTiles", 1).to_f, 1].max
        x = item.fetch("centerX", 0).to_f + radius * Math.cos(theta)
        y = item.fetch("centerY", 0).to_f + radius * Math.sin(theta)
      when "parametricMesh"
        x = evaluate_expression(item["xExpression"], i: i, j: j)
        y = evaluate_expression(item["yExpression"], i: i, j: j)
      when "regularPolygonCurve"
        sides = [item.fetch("sides", 3).to_i, 3].max
        segments = [item.fetch("segmentsPerSide", 1).to_i, 1].max
        side = i.to_i / segments
        part = (i.to_i % segments).to_f / segments
        vertex = lambda do |number|
          theta = item.fetch("angle", 0).to_f + number * Math::PI * 2 / sides
          [item.fetch("centerX", 0).to_f + item.fetch("radius", 50).to_f * Math.cos(theta),
           item.fetch("centerY", 0).to_f + item.fetch("radius", 50).to_f * Math.sin(theta)]
        end
        first, second = vertex.call(side), vertex.call((side + 1) % sides)
        x = first[0] + (second[0] - first[0]) * part
        y = first[1] + (second[1] - first[1]) * part
      when "bezierCurve"
        points = item.fetch("controlPoints", []).map { |entry| [entry["x"] || entry[0] || 0, entry["y"] || entry[1] || 0].map(&:to_f) }
        t = i / [item.fetch("segments", 1).to_f, 1].max
        (points.length - 1).downto(1) { |level| (0...level).each { |index| points[index] = [points[index][0] + (points[index + 1][0] - points[index][0]) * t, points[index][1] + (points[index + 1][1] - points[index][1]) * t] } }
        x, y = points.first || [0, 0]
      when "penCurve"
        node = item.fetch("commands", [])[i.to_i] || {}
        x = (node["x"] || node[1] || 0).to_f
        y = (node["y"] || node[2] || 0).to_f
      when "parametricCurve"
        x = evaluate_expression(item["xExpression"], i: i)
        y = evaluate_expression(item["yExpression"], i: i)
      else
        x = item.fetch("centerX", item.fetch("topLeftX", 0)).to_f
        y = item.fetch("centerY", item.fetch("topLeftY", 0)).to_f
      end
      transform = item.fetch("transformation", [1, 0, 0, 1, 0, 0])
      Vector2D.new(transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5])
    end

    def evaluate_expression(expression, scope)
      return expression.to_f if expression.is_a?(Numeric) && expression.to_f.finite?
      MathExpression.new(expression.to_s, scope).evaluate
    end

    def integer_range(range, exclusive = false, force_exclusive = false)
      unless range.is_a?(Array) && range.length == 2 && range.all? { |value| value.is_a?(Integer) }
        raise TypeError, "range must contain two integers"
      end
      first, last = range
      direction = last >= first ? 1 : -1
      values = []
      value = first
      while direction.positive? ? value < last : value > last
        values << value
        value += direction
      end
      values << last unless exclusive || force_exclusive
      values
    end

    def snap_points(item)
      case item["type"]
      when "rectangularMesh"
        (0..item.fetch("horizontalTiles", 1).to_i).flat_map { |i| (0..item.fetch("verticalTiles", 1).to_i).map { |j| [i, j] } }
      when "radialMesh"
        (0...item.fetch("azimuthalTiles", 1).to_i).flat_map { |i| (0..item.fetch("radialTiles", 1).to_i).map { |j| [i, j] } }
      when "parametricMesh"
        integer_range(item["iRange"], item["iRangeExclusive"]).product(integer_range(item["jRange"], item["jRangeExclusive"]))
      when "parametricCurve"
        integer_range(item["iRange"], item["iRangeExclusive"], item["closed"])
      else
        count = item["type"] == "regularPolygonCurve" ? item.fetch("sides", 3).to_i * item.fetch("segmentsPerSide", 1).to_i : item.fetch("segments", 16).to_i
		count = [count, 1].max
		item["type"] == "regularPolygonCurve" || item["closed"] ? (0...count).to_a : (0..count).to_a
      end
    end

    def nearest_snap_point(item, x, y)
      snap_points(item).map do |point|
        position = snap_point_position(item, point)
        [Math.hypot(position.x - x, position.y - y), point]
      end.min_by(&:first)&.last || 0
    end

    def checked_snap_point(item, values)
      expected = MESH_SNAPPEE_TYPES.include?(item["type"]) ? 2 : CURVE_SNAPPEE_TYPES.include?(item["type"]) ? 1 : 0
      unless expected.positive? && values.length == expected && values.all? { |value| value.is_a?(Integer) }
        raise TypeError, "snap point expects one curve index or two mesh indices"
      end
      expected == 2 ? values : values.first
    end

    def transform(things, matrix)
      values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]
      visit = lambda do |value|
        item = ensure_alive(value, value.is_a?(Snappee) ? "Snappee" : "Event")
        item.fetch("events", []).each { |child| visit.call(child) } if item["type"] == "group"
        if TIP_POINTABLE_TYPES.include?(item["type"]) && %w[chain drop].include?(item["tipPointSpawnType"])
          if item["tipPointSpawnAbsolutePosition"]
            position = if item["tipPointSpawnAttached"]
                         target = find("snappee", item["tipPointSpawnSnappee"])
                         raise RuntimeError, "attached tip-point snappee does not exist" unless target
                         snap_point_position(target, item["tipPointSpawnSnapPoint"])
                       else
                         Vector2D.new(item.fetch("tipPointSpawnX", 0), item.fetch("tipPointSpawnY", 0))
                       end
            item["tipPointSpawnAttached"] = false
            item["tipPointSpawnX"] = values[0] * position.x + values[2] * position.y + values[4]
            item["tipPointSpawnY"] = values[1] * position.x + values[3] * position.y + values[5]
            item.delete("tipPointSpawnSnappee"); item.delete("tipPointSpawnSnapPoint")
          else
            distance = [item.fetch("tipPointSpawnDistance", 0).to_f, 0].max
            angle_value = item.fetch("tipPointSpawnAngle", Math::PI / 2).to_f
            origin_x, origin_y = values[4], values[5]
            endpoint_x = values[0] * Math.cos(angle_value) * distance + values[2] * Math.sin(angle_value) * distance + values[4]
            endpoint_y = values[1] * Math.cos(angle_value) * distance + values[3] * Math.sin(angle_value) * distance + values[5]
            dx, dy = endpoint_x - origin_x, endpoint_y - origin_y
            item["tipPointSpawnDistance"] = Math.hypot(dx, dy)
            item["tipPointSpawnAngle"] = Math.atan2(dy, dx) if item["tipPointSpawnDistance"] > 1e-12
          end
        end
        if item["attached"]
          target = find("snappee", item["snappee"])
          raise RuntimeError, "attached snappee does not exist" unless target
          position = snap_point_position(target, item["snapPoint"])
          point = Vector2D.new(values[0] * position.x + values[2] * position.y + values[4], values[1] * position.x + values[3] * position.y + values[5])
          assign_location(item, Location.new(point.x, point.y))
        elsif item["x"] && item["y"]
          x, y = item["x"].to_f, item["y"].to_f
          item["x"] = values[0] * x + values[2] * y + values[4]
          item["y"] = values[1] * x + values[3] * y + values[5]
        end
        if item["type"] == "flick" && item["angle"]
          cosine, sine = Math.cos(item["angle"]), Math.sin(item["angle"])
          item["angle"] = Math.atan2(values[1] * cosine + values[3] * sine, values[0] * cosine + values[2] * sine)
        end
        if item["transformation"]
          old = item["transformation"]
          item["transformation"] = [values[0] * old[0] + values[2] * old[1], values[1] * old[0] + values[3] * old[1],
                                    values[0] * old[2] + values[2] * old[3], values[1] * old[2] + values[3] * old[3],
                                    values[0] * old[4] + values[2] * old[5] + values[4], values[1] * old[4] + values[3] * old[5] + values[5]]
        end
      end
      Array(things).each { |thing| visit.call(thing) }
      things
    end
  end
end

class Snappee
  CLASS_BY_TYPE = {} unless const_defined?(:CLASS_BY_TYPE, false)

  class << self
    def new(type = :rectangular_mesh, *args, name: nil, color: nil)
      create(type, args, name: name, color: color)
    end

    def create(type, args, name: nil, color: nil)
      type_name = SviberMacroInternals.type_name(type)
      fields = case type_name
               when "rectangularMesh"
                 { top_left_x: args[0], top_left_y: args[1], bottom_right_x: args[2], bottom_right_y: args[3], horizontal_tiles: args[4], vertical_tiles: args[5] }
               when "radialMesh"
                 { center_x: args[0], center_y: args[1], radius: args[2], azimuthal_tiles: args[3], radial_tiles: args[4], starting_angle: args[5].nil? ? nil : SviberMacroInternals.angle(args[5]) }
               when "parametricMesh"
                 { i_range: args[0], j_range: args[1], x_expression: args[2], y_expression: args[3] }
               when "regularPolygonCurve"
                 { center_x: args[0], center_y: args[1], radius: args[2], angle: args[3].nil? ? nil : SviberMacroInternals.angle(args[3]), sides: args[4], segments_per_side: args[5] }
               when "bezierCurve"
                 { degree: args[0], control_points: args[1], segments: args[2] }
               when "parametricCurve"
                 { i_range: args[0], x_expression: args[1], y_expression: args[2] }
               when "penCurve"
                 { commands: args[0], segments: args[1], closed: args[2] }
               else
                 raise TypeError, "Unsupported snappee type: #{type_name}"
               end
      fields[:name] = name unless name.nil?
      fields[:color] = color unless color.nil?
      wrap(SviberMacroInternals.add_snappee(type_name, fields.compact))
    end

    def wrap(raw)
      return nil unless raw
      wrapper = CLASS_BY_TYPE.fetch(raw["type"], Snappee)
      wrapper.allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
    end

    def get(value)
      raise TypeError, "snappee number must be an Integer or name" unless value.is_a?(Integer) || value.is_a?(String)
      raw = if value.is_a?(String)
              SviberMacroInternals.snappees.find { |item| item["name"] == value }
            elsif value >= 0
              SviberMacroInternals.snappees[value]
            end
      wrap(raw)
    end

    def get_by_id(id) = wrap(SviberMacroInternals.find("snappee", id))
    def selected = wrap(SviberMacroInternals.snappees.find { |item| item["selected"] })
    def list = SviberMacroInternals.snappees.map { |raw| wrap(raw) }

    def deselect
      SviberMacroInternals.snappees.each { |item| item["selected"] = false }
      nil
    end
  end

  def id = record["id"]
  def name = record["name"]
  def name=(value)
    record["name"] = value.to_s
  end
  def color = record["color"]
  def color=(value)
    record["color"] = SviberMacroInternals.css_color(value)
  end
  def active? = record["active"] != false
  def selected? = !!record["selected"]

  def activate
    record["active"] = true
    self
  end

  def deactivate
    raw = record
    raw["active"] = false
    raw["selected"] = false
    self
  end

  def select
    raw = record
    Snappee.deselect
    raw["selected"] = true
    self
  end

  def pos(*indices)
    raw = record
    SviberMacroInternals.snap_point_position(raw, SviberMacroInternals.checked_snap_point(raw, indices))
  end

  def move_up = reorder(-1)
  def move_down = reorder(1)

  def duplicate(name = self.name, color = self.color)
    copy = SviberMacroInternals.deep_copy(record)
    copy.delete("id")
    copy["name"] = name.to_s
    copy["color"] = SviberMacroInternals.css_color(color)
    Snappee.wrap(SviberMacroInternals.add_snappee(copy.delete("type"), copy))
  end

  def delete
    raw = record
    SviberMacroInternals.snappees.delete(raw)
    raw["__deleted"] = true
    self
  end

  def to_h = SviberMacroInternals.deep_copy(record)
  def to_json(*args) = to_h.to_json(*args)

  private

  def record = SviberMacroInternals.ensure_alive(self, "Snappee")

  def reorder(delta)
    raw = record
    index = SviberMacroInternals.snappees.index(raw)
    target = index + delta
    if target.between?(0, SviberMacroInternals.snappees.length - 1)
      SviberMacroInternals.snappees[index], SviberMacroInternals.snappees[target] = SviberMacroInternals.snappees[target], SviberMacroInternals.snappees[index]
    end
    self
  end
end

class RectangularMesh < Snappee
  def self.new(*args, name: nil, color: nil) = create(:rectangular_mesh, args, name: name, color: color)
end

class RadialMesh < Snappee
  def self.new(*args, name: nil, color: nil) = create(:radial_mesh, args, name: name, color: color)
end

class ParametricMesh < Snappee
  def self.new(*args, name: nil, color: nil) = create(:parametric_mesh, args, name: name, color: color)
end

class RegularPolygonCurve < Snappee
  def self.new(*args, name: nil, color: nil) = create(:regular_polygon_curve, args, name: name, color: color)
end

class BezierCurve < Snappee
  def self.new(*args, name: nil, color: nil) = create(:bezier_curve, args, name: name, color: color)
end

class PenCurve < Snappee
  def self.new(*args, name: nil, color: nil) = create(:pen_curve, args, name: name, color: color)
end

class ParametricCurve < Snappee
  def self.new(*args, name: nil, color: nil) = create(:parametric_curve, args, name: name, color: color)
end

Snappee::CLASS_BY_TYPE.merge!(
  "rectangularMesh" => RectangularMesh, "radialMesh" => RadialMesh, "parametricMesh" => ParametricMesh,
  "regularPolygonCurve" => RegularPolygonCurve, "bezierCurve" => BezierCurve,
  "penCurve" => PenCurve, "parametricCurve" => ParametricCurve
)

class Event
  CLASS_BY_TYPE = {} unless const_defined?(:CLASS_BY_TYPE, false)

  class << self
    def new(type:, **values) = create(type, values)

    def create(type, values)
      values = values.dup
      if values.key?(:channel) && !values[:channel].is_a?(Channel)
        raise TypeError, "channel must be a Channel"
      end
      values[:time] = SviberMacroInternals.beat(values[:time]) if values.key?(:time)
      values[:duration] = SviberMacroInternals.beat(values[:duration]) if values.key?(:duration)
      wrap(SviberMacroInternals.add_event(type, values))
    end

    def wrap(raw)
      return nil unless raw
      wrapper = CLASS_BY_TYPE.fetch(raw["type"], Event)
      wrapper.allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
    end

    def list = SviberMacroInternals.events.map { |raw| wrap(raw) }
    def selection = SviberMacroInternals.all_events.select { |item| item["selected"] }.map { |raw| wrap(raw) }
  end

  def type = SviberMacroInternals::RUBY_EVENT_TYPES.fetch(record["type"], record["type"].to_sym)

  def type=(value)
    raw = record
    old_id = raw["id"]
    replacement = SviberMacroInternals.add_event(value, SviberMacroInternals.deep_copy(raw))
    SviberMacroInternals.events.pop
    replacement["id"] = old_id
    raw.replace(replacement)
    value
  end

  def movable? = SviberMacroInternals::MOVABLE_TYPES.include?(record["type"])
  def have_time? = record["type"] == "group" || record.key?("time")
  def have_channel? = record["type"] != "group" && record.key?("channel")
  def have_duration? = SviberMacroInternals::DURATION_TYPES.include?(record["type"])
  def have_text? = SviberMacroInternals::TEXT_TYPES.include?(record["type"])
  def tip_pointable? = SviberMacroInternals::TIP_POINTABLE_TYPES.include?(record["type"])
  def group? = record["type"] == "group"

  def location
    raise RuntimeError, "#{type} events do not have a location" unless movable?
    location_for(record)
  end

  def location=(value)
    raise RuntimeError, "#{type} events do not have a location" unless movable?
    raise TypeError, "location must be a Location" unless value.is_a?(Location)
    raw = record
    before = location.pos
    after = value.pos
    if group?
      SviberMacroInternals.descendants(raw).each do |child|
        next unless SviberMacroInternals::MOVABLE_TYPES.include?(child["type"])
        point = location_for(child).pos
        SviberMacroInternals.assign_location(child, Location.new(point.x + after.x - before.x, point.y + after.y - before.y))
      end
    end
    SviberMacroInternals.assign_location(raw, value)
    value
  end

  def anchor
    raise RuntimeError, "anchor is only valid for groups" unless group?
    location_for(record)
  end

  def anchor=(value)
    raise RuntimeError, "anchor is only valid for groups" unless group?
    raise TypeError, "anchor must be a Location" unless value.is_a?(Location)
    SviberMacroInternals.assign_location(record, value)
    value
  end

  def text
    raise RuntimeError, "#{type} events do not have text" unless have_text?
    record["text"]
  end

  def text=(value)
    raise RuntimeError, "#{type} events do not have text" unless have_text?
    record["text"] = value.to_s
  end

  def angle
    raise RuntimeError, "angle is only valid for flick events" unless type == :flick
    record["angle"]
  end

  def angle=(value)
    raise RuntimeError, "angle is only valid for flick events" unless type == :flick
    record["angle"] = SviberMacroInternals.angle(value)
  end

  def time
    raw = record
    raw["type"] == "group" ? SviberMacroInternals.event_time(raw) : SviberMacroInternals.rational_data(raw["time"])
  end

  def time=(value)
    target = SviberMacroInternals.rational(value)
    raw = record
    if raw["type"] == "group"
      delta = target - SviberMacroInternals.event_time(raw)
      SviberMacroInternals.descendants(raw).each do |child|
        child["time"] = SviberMacroInternals.beat_from_rational(SviberMacroInternals.rational_data(child["time"]) + delta) if child["time"]
      end
    else
      raw["time"] = SviberMacroInternals.beat_from_rational(target)
    end
    value
  end

  def channel
    raise RuntimeError, "groups do not have channels" unless have_channel?
    Channel.get_by_id(record["channel"])
  end

  def channel=(value)
    raise RuntimeError, "groups do not have channels" unless have_channel?
    raise TypeError, "channel must be a Channel" unless value.is_a?(Channel)
    SviberMacroInternals.ensure_alive(value, "Channel")
    record["channel"] = value.id
  end

  def events
    raise RuntimeError, "only groups have events" unless group?
    record.fetch("events", []).map { |item| Event.wrap(item) }
  end

  def color
    raise RuntimeError, "only groups have colors" unless group?
    record["color"]
  end

  def color=(value)
    raise RuntimeError, "only groups have colors" unless group?
    record["color"] = SviberMacroInternals.css_color(value)
  end

  def tip_point
    raise RuntimeError, "#{type} events do not have tip points" unless tip_pointable?
    raw = record
    absolute = !!raw["tipPointSpawnAbsolutePosition"]
    location = if absolute
                 if raw["tipPointSpawnAttached"]
                   Location.new(Snappee.get_by_id(raw["tipPointSpawnSnappee"]), *Array(raw["tipPointSpawnSnapPoint"]))
                 else
                   Location.new(raw["tipPointSpawnX"], raw["tipPointSpawnY"])
                 end
               end
    TipPoint.new(raw.fetch("tipPointSpawnType", "inherit").to_sym,
                 location: location,
                 distance: absolute ? nil : raw["tipPointSpawnDistance"],
                 angle: absolute ? nil : raw["tipPointSpawnAngle"],
                 time_seconds: raw["tipPointSpawnTimeBeats"] ? nil : raw["tipPointSpawnTime"],
                 time_beats: raw["tipPointSpawnTimeBeats"] ? SviberMacroInternals.rational_data(raw["tipPointSpawnTime"]) : nil)
  end

  def tip_point=(value)
    raise RuntimeError, "#{type} events do not have tip points" unless tip_pointable?
    raw = record
    raw.keys.grep(/\AtipPointSpawn/).each { |key| raw.delete(key) }
    raw.merge!(SviberMacroInternals.tip_point_fields(value))
    value
  end

  def delete
    raw = record
    SviberMacroInternals.remove_event(raw)
    raw["__deleted"] = true
    self
  end

  private

  def record = SviberMacroInternals.ensure_alive(self, "Event")

  def location_for(raw)
    return Location.new(raw.fetch("x", 0), raw.fetch("y", 0)) unless raw["attached"]
    target = Snappee.get_by_id(raw["snappee"])
    raise RuntimeError, "attached snappee does not exist" unless target
    point = raw.fetch("snapPoint", 0)
    point.is_a?(Array) ? Location.new(target, *point) : Location.new(target, point)
  end
end

class Tap < Event; def self.new(**values) = create(:tap, values); end
class Hold < Event; def self.new(**values) = create(:hold, values); end
class Drag < Event; def self.new(**values) = create(:drag, values); end
class Flick < Event; def self.new(**values) = create(:flick, values); end
class BgNote < Event; def self.new(**values) = create(:bg_note, values); end
class BigText < Event; def self.new(**values) = create(:big_text, values); end
class Grid < Event; def self.new(**values) = create(:grid, values); end
class DiamondGrid < Event; def self.new(**values) = create(:diamond_grid, values); end
class Hexagon < Event; def self.new(**values) = create(:hexagon, values); end
class Checkerboard < Event; def self.new(**values) = create(:checkerboard, values); end
class Pentagon < Event; def self.new(**values) = create(:pentagon, values); end
class Turntable < Event; def self.new(**values) = create(:turntable, values); end
class Hexagram < Event; def self.new(**values) = create(:hexagram, values); end
class Comment < Event; def self.new(**values) = create(:comment, values); end
class Group < Event; def self.new(**values) = create(:group, values); end

Event::CLASS_BY_TYPE.merge!(
  "tap" => Tap, "hold" => Hold, "drag" => Drag, "flick" => Flick, "bgNote" => BgNote,
  "bigText" => BigText, "grid" => Grid, "diamondGrid" => DiamondGrid, "hexagon" => Hexagon,
  "checkerboard" => Checkerboard, "pentagon" => Pentagon, "turntable" => Turntable,
  "hexagram" => Hexagram, "comment" => Comment, "group" => Group
)

class Clip
  class << self
    def new(events, name = nil)
      raise TypeError, "events must be an Array" unless events.is_a?(Array)
      raw = { "name" => (name || "Clip #{SviberMacroInternals.clips.length + 1}").to_s,
              "data" => SviberMacroInternals.clip_data_for(events) }
      SviberMacroInternals.clips << raw
      wrap(raw)
    end

    def wrap(raw)
      return nil unless raw
      allocate.tap { |item| item.instance_variable_set(:@raw, raw) }
    end

    def get(index)
      raise TypeError, "clip number must be an Integer" unless index.is_a?(Integer)
      wrap(SviberMacroInternals.clips[index]) if index >= 0
    end
  end

  def name = record["name"]
  def name=(value)
    record["name"] = value.to_s
  end
  def move_up = reorder(-1)
  def move_down = reorder(1)

  def paste(time, channel)
    raise TypeError, "channel must be a Channel" unless channel.is_a?(Channel)
    SviberMacroInternals.ensure_alive(channel, "Channel")
    SviberMacroInternals.paste_clip_data(record["data"], SviberMacroInternals.rational(time), channel)
  end

  def delete
    raw = record
    SviberMacroInternals.clips.delete(raw)
    raw["__deleted"] = true
    self
  end

  def to_h = SviberMacroInternals.deep_copy(record)
  def to_json(*args) = to_h.to_json(*args)

  private

  def record = SviberMacroInternals.ensure_alive(self, "Clip")

  def reorder(delta)
    raw = record
    index = SviberMacroInternals.clips.index(raw)
    target = index + delta
    if target.between?(0, SviberMacroInternals.clips.length - 1)
      SviberMacroInternals.clips[index], SviberMacroInternals.clips[target] = SviberMacroInternals.clips[target], SviberMacroInternals.clips[index]
    end
    self
  end
end

module Chart
  class << self
    def current_time = SviberMacroInternals.rational_data(SviberMacroInternals.editor.fetch("currentTime", [0, 0, 1]))
    def current_time=(value)
      SviberMacroInternals.editor["currentTime"] = SviberMacroInternals.beat(value)
    end
    def channels = Channel.list
    def current_channel = Channel.current
    def snappees = Snappee.list
    def selected_snappee = Snappee.selected
    def clips = SviberMacroInternals.clips.map { |raw| Clip.wrap(raw) }
    def events = Event.list
    def selected_events = Event.selection
    def offset = SviberMacroInternals.timing.fetch("offset", 0)
    def offset=(value)
      SviberMacroInternals.timing["offset"] = value.to_f
    end
    def initial_bpm = SviberMacroInternals.timing.fetch("initialBpm", 120)
    def initial_bpm=(value)
      SviberMacroInternals.timing["initialBpm"] = value.to_f
    end
    def bpm_changes = BpmChange.list
    def bar_lines = BarLine.list
  end
end

def b(value = SviberMacroInternals::MISSING)
  return Chart.current_time if value.equal?(SviberMacroInternals::MISSING)
  Chart.current_time = Chart.current_time + SviberMacroInternals.rational(value)
end

define_method(:"b!") do |value = SviberMacroInternals::MISSING|
  next Chart.current_time if value.equal?(SviberMacroInternals::MISSING)
  Chart.current_time = value
end

def bpm(the_bpm)
  time = Chart.current_time
  existing = BpmChange.list.find { |change| change.time == time }
  existing ? existing.bpm = the_bpm : BpmChange.new(time, the_bpm)
  the_bpm
end

def c(name) = (Channel.get(name) || Channel.new(name: name)).select
def s(value) = Snappee.get(value)
def l(*args) = Location.new(*args)

def tpc(distance_or_location, angle_or_time = nil, time = nil)
  if distance_or_location.is_a?(Location)
    values = angle_or_time.is_a?(Float) ? { time_seconds: angle_or_time } : { time_beats: angle_or_time }
    TipPoint.chain(location: distance_or_location, **values)
  else
    values = time.is_a?(Float) ? { time_seconds: time } : { time_beats: time }
    TipPoint.chain(distance: distance_or_location, angle: angle_or_time, **values)
  end
end

def tpd(distance_or_location, angle_or_time = nil, time = nil)
  if distance_or_location.is_a?(Location)
    values = angle_or_time.is_a?(Float) ? { time_seconds: angle_or_time } : { time_beats: angle_or_time }
    TipPoint.drop(location: distance_or_location, **values)
  else
    values = time.is_a?(Float) ? { time_seconds: time } : { time_beats: time }
    TipPoint.drop(distance: distance_or_location, angle: angle_or_time, **values)
  end
end

def t(location, text = "") = Tap.new(location: location, time: Chart.current_time, channel: Channel.current, text: text)
def h(location, duration, text = "") = Hold.new(location: location, time: Chart.current_time, channel: Channel.current, duration: duration, text: text)
def d(location) = Drag.new(location: location, time: Chart.current_time, channel: Channel.current)
def f(location, angle, text = "") = Flick.new(location: location, time: Chart.current_time, channel: Channel.current, angle: angle, text: text)

def bg_note(location, duration = 0, text = "")
  if duration.is_a?(String) && text.empty?
    text = duration
    duration = 0
  end
  BgNote.new(location: location, time: Chart.current_time, channel: Channel.current, duration: duration, text: text)
end

def big_text(duration, text = "") = BigText.new(time: Chart.current_time, channel: Channel.current, duration: duration, text: text)
def grid(duration) = Grid.new(time: Chart.current_time, channel: Channel.current, duration: duration)
def diamond_grid(duration) = DiamondGrid.new(time: Chart.current_time, channel: Channel.current, duration: duration)
def hexagon(duration) = Hexagon.new(time: Chart.current_time, channel: Channel.current, duration: duration)
def checkerboard(duration) = Checkerboard.new(time: Chart.current_time, channel: Channel.current, duration: duration)
def pentagon(duration) = Pentagon.new(time: Chart.current_time, channel: Channel.current, duration: duration)
def turntable(duration) = Turntable.new(time: Chart.current_time, channel: Channel.current, duration: duration)
def hexagram(duration) = Hexagram.new(time: Chart.current_time, channel: Channel.current, duration: duration)

def g(events_or_color = nil, color = nil, &block)
  if block
    color = events_or_color unless events_or_color.nil?
    before = SviberMacroInternals.events.dup
    block.call
    children = SviberMacroInternals.events.reject { |item| before.include?(item) }
  else
    raise TypeError, "events must be an Array" unless events_or_color.is_a?(Array)
    children = events_or_color.map { |item| SviberMacroInternals.ensure_alive(item, "Event") }
  end
  children.each { |item| SviberMacroInternals.detach_event(item) }
  Group.create(:group, events: children, color: color || "#ff9d3d")
end

def copy(events)
  raise TypeError, "events must be an Array" unless events.is_a?(Array)
  SviberMacroInternals.shifted_copies(events, Chart.current_time, Channel.current)
end

def transform(things, matrix = nil, &block)
  if block
    raise ArgumentError, "provide a matrix or a block, not both" if matrix
    matrix = AffineMatrix2D.new
    matrix.instance_eval(&block)
  end
  raise TypeError, "matrix must be an AffineMatrix2D" unless matrix.is_a?(AffineMatrix2D)
  targets = things.is_a?(Array) ? things : [things]
  unless targets.all? { |target| target.is_a?(Event) } || targets.all? { |target| target.is_a?(Snappee) }
    raise TypeError, "things must be an event, a snappee, an array of events, or an array of snappees"
  end
  SviberMacroInternals.transform(targets, matrix)
  things
end

$__sviber_macro_logs = []
$stdout = SviberMacroInternals::Output.new("log", $__sviber_macro_logs)
$stderr = SviberMacroInternals::Output.new("error", $__sviber_macro_logs)
