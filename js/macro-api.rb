require "json"
require "base64"

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

require "set"
$sviber_macro_logs = []
$stdout = SviberMacroOutput.new("log", $sviber_macro_logs)
$stderr = SviberMacroOutput.new("error", $sviber_macro_logs)
$sviber = SviberMacroAPI.new

def sviber = $sviber
def state = $sviber.state
def chart = $sviber.state
def tap(...) = $sviber.tap(...)
def t(...) = $sviber.tap(...)
def hold(...) = $sviber.hold(...)
def h(...) = $sviber.hold(...)
def drag(...) = $sviber.drag(...)
def d(...) = $sviber.drag(...)
def flick(...) = $sviber.flick(...)
def f(...) = $sviber.flick(...)
def bg_note(...) = $sviber.bg_note(...)
def bg(...) = $sviber.bg_note(...)
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
def log(*values) = $stdout.puts(*values)
