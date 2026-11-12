using Grasshopper.Kernel;
using System.Collections.Generic;
using static SelvaBuilder;

public static partial class Definitions
{
    // ============================================================================
    // Dependent forms tutorial: Set Dynamic Value List, Repeat, Options Table
    // ============================================================================

    static List<(IGH_DocumentObject, object)> Tutorial(B b)
    {
        b.Note("DEPENDENT FORMS TUTORIAL\n" +
               "Three ways to fill a dropdown (a Get Dynamic Value List) from Grasshopper.\n" +
               "Each one is wired into the dropdown AND into a Context Bake.\n" +
               "Turn on the UI Bridge at the bottom to open the form.", w: 640, h: 62);

        var slices = SliceSection(b);
        var toppings = ToppingSection(b);
        var menu = MenuSection(b);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(Json(@"{
  'name': 'Dependent forms tutorial',
  'description': 'Set Dynamic Value List, Repeat and Options Table, one group each.',
  'tabs': [ { 'label': 'Pizza', 'groups': [
    { 'label': '1. Set Dynamic Value List', 'items': [
      { 'param': 'Pizza size', 'label': 'Pizza size (cm)', " + SliderConfig + @" }, 'Slices', 'Cut' ] },
    { 'label': '2. Repeat', 'items': [
      { 'param': 'Guests', " + SliderConfig + @" }, 'Topping', 'Toppings ordered' ] },
    { 'label': '3. Options Table', 'items': [ 'Pizza', 'Size', 'Order' ] } ] } ] }"));

        return new List<(IGH_DocumentObject, object)>
        {
            (slices.Options, 0), (slices.Get, null), (slices.Text, 0),
            (toppings.Rows, 0), (toppings.Get, null), (toppings.Text, 0),
            (menu.Table, 0), (menu.Pizza, null), (menu.Size, null), (menu.Text, 0)
        };
    }

    // ============================================================================
    // Sections
    // ============================================================================

    static (IGH_DocumentObject Options, IGH_DocumentObject Get, IGH_DocumentObject Text) SliceSection(B b)
    {
        var note = b.Note("1. SET DYNAMIC VALUE LIST\n" +
                          "A list whose choices you calculate: a bigger pizza can be cut into more slices.\n" +
                          "Wire it into Slices AND into a Context Bake.\n" +
                          "Try: change Pizza size in the form, then open Slices again.", w: 640, h: 62);
        var size = b.Number("Pizza size", 20, 30, 50, 0);
        var counts = b.Series(Start: 2, Step: 2, Count: b.Ev("Floor(x/10)", "How many choices", size), nick: "Slice counts");
        var lines = b.Format(Format: "\"{0} slices\" = {0}", Data0: counts, nick: "Choices as text");
        var set = b.SetDynamicValueList(Options: lines, nick: "Slice choices");
        var slices = b.Add(GetDynamicValueList, nick: "Slices");
        b.W(set.Obj, slices, null);
        b.Output("Slice choices", set.Obj);

        var text = b.Concatenate(FragmentA: size, FragmentB: " cm pizza, slices: ", inputs: 3, nick: "Cut text");
        b.Feed(text.Obj, 2, slices);
        b.Print("Cut", text.Obj);
        b.Section("1. Set Dynamic Value List", note);
        return (set.Obj, slices, text.Obj);
    }

    static (IGH_DocumentObject Rows, IGH_DocumentObject Get, IGH_DocumentObject Text) ToppingSection(B b)
    {
        var note = b.Note("2. REPEAT\n" +
                          "Asks the same question once per guest.\n" +
                          "Wire: guest names into Keys, the topping list into Options, Repeat into Topping AND a Context Bake.\n" +
                          "Try: change Guests in the form.", w: 640, h: 62);
        var guests = b.Number("Guests", 1, 3, 6, 0);
        var names = b.Format(Format: "Guest {0}", Data0: b.Series(Start: 1, Step: 1, Count: guests, nick: "Guest numbers"), nick: "Guest names");
        var list = b.Panel("Margherita\nMushroom\nSalami\nPineapple", name: "Topping list", w: 150, h: 100);
        var repeat = b.Add(Repeat, nick: "Once per guest");
        b.W(names.Obj, repeat, "Keys");
        b.W(list, repeat, "Options");
        var topping = b.Add(GetDynamicValueList, nick: "Topping");
        b.W(repeat, topping, null);
        b.Output("Once per guest", repeat);

        var line = b.Concatenate(FragmentA: names, FragmentB: ": ", inputs: 3, nick: "Guest line");
        b.Feed(line.Obj, 2, topping);
        var text = b.TextJoin(Text: line, Join: "\n", nick: "All guests");
        b.Print("Toppings ordered", text.Obj);
        b.Section("2. Repeat", note);
        return (repeat, topping, line.Obj);
    }

    static (IGH_DocumentObject Table, IGH_DocumentObject Pizza, IGH_DocumentObject Size, IGH_DocumentObject Text) MenuSection(B b)
    {
        var note = b.Note("3. OPTIONS TABLE\n" +
                          "A table of what goes together: each line is one pizza you can order.\n" +
                          "Wire Options Table into Pizza AND into a Context Bake, then Pizza into Size.\n" +
                          "Try: pick Mushroom in the form. Size only offers Large.", w: 640, h: 62);
        var menu = b.Panel("Pizza, Size\n" +
                           "Margherita, Small\n" +
                           "Margherita, Large\n" +
                           "Salami, Large\n" +
                           "Salami, Family\n" +
                           "Mushroom, Large", name: "Menu", w: 180, h: 145);
        var table = b.Add(OptionsTable, nick: "Menu table");
        b.W(menu, table, "Table");
        var pizza = b.Add(GetDynamicValueList, nick: "Pizza");
        b.W(table, pizza, null);
        var size = b.Add(GetDynamicValueList, nick: "Size");
        b.W(pizza, size, null);
        b.Output("Menu table", table);

        var text = b.Concatenate(FragmentA: size, FragmentB: " ", inputs: 3, nick: "Order text");
        b.Feed(text.Obj, 2, pizza);
        b.Print("Order", text.Obj);
        b.Section("3. Options Table", note);
        return (table, pizza, size, text.Obj);
    }
}
